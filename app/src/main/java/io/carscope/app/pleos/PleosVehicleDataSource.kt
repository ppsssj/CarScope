package io.carscope.app.pleos

import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.DoorId
import io.carscope.vehicle.DoorPosition
import io.carscope.vehicle.Reading
import io.carscope.vehicle.UnavailableReason
import io.carscope.vehicle.VehicleDataSource
import io.carscope.vehicle.VehicleSnapshot
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Only the verified 0..1 Door Position encoding is accepted in this first adapter. */
internal fun mapDoorPosition(raw: Int?, min: Int?, max: Int?, time: Long): Reading<DoorPosition> =
    when {
        min != 0 || max != 1 -> Reading.Unavailable(UnavailableReason.UNKNOWN)
        raw == 0 -> Reading.Available(DoorPosition.CLOSED, time)
        raw == 1 -> Reading.Available(DoorPosition.OPEN, time)
        else -> Reading.Unavailable(UnavailableReason.UNKNOWN)
    }

internal data class DoorCapability(val readable: Boolean, val min: Int?, val max: Int?, val access: String)

/** App boundary for the typed SDK; it deliberately exposes no vehicle control operation. */
internal interface DoorSession {
    fun initialize()
    fun capability(complete: (DoorCapability) -> Unit, failed: (Exception) -> Unit)
    fun read(complete: (Int?) -> Unit, failed: (Exception) -> Unit)
    fun subscribe(updated: (Int?) -> Unit, failed: (Exception) -> Unit)
    fun unsubscribe()
    fun release()
}

internal interface DoorDispatcher {
    fun execute(action: () -> Unit)
    fun close()
}

internal class WorkerDoorDispatcher : DoorDispatcher {
    private val worker = Executors.newSingleThreadExecutor { action -> Thread(action, "CarScope-Door") }
    override fun execute(action: () -> Unit) {
        // A released SDK may deliver a queued callback; it no longer owns this source.
        try { worker.execute(action) } catch (_: RejectedExecutionException) { }
    }
    override fun close() { worker.shutdown() }
}

/** Nonblocking cache. All SDK operations and callbacks are serialized off the UI thread. */
internal class PleosVehicleDataSource(
    private val factory: () -> DoorSession,
    private val dispatcher: DoorDispatcher = WorkerDoorDispatcher(),
    private val clock: () -> Long = System::currentTimeMillis,
    private val log: (String) -> Unit = {},
) : VehicleDataSource {
    private class Session(val transport: DoorSession) {
        var accepting = true
        var pending = 0
        var registered = false
        var eventRevision = 0L
        var capability: DoorCapability? = null
    }

    private var session: Session? = null
    private var wanted = false
    private var closed = false
    @Volatile private var snapshot = snapshotOf(Reading.Unavailable(UnavailableReason.DISCONNECTED))
    @Volatile var status: String = "PLEOS · stopped · ROW_1_LEFT only"
        private set

    override fun readSnapshot(): VehicleSnapshot = snapshot

    fun start() = dispatcher.execute {
        if (!closed) {
            wanted = true
            if (session == null) openSession()
        }
    }

    fun stop() = dispatcher.execute {
        wanted = false
        stopSession()
    }

    fun close() = dispatcher.execute {
        closed = true
        wanted = false
        stopSession()
        if (session == null) dispatcher.close()
    }

    private fun openSession() {
        try {
            val current = Session(factory())
            session = current
            current.transport.initialize()
            report("initialize returned (connection not yet proven)")
            request<DoorCapability>(current, { ok, fail -> current.transport.capability(ok, fail) }) { capability ->
                current.capability = capability
                report("capability access=${capability.access} range=${capability.min}..${capability.max}")
                if (!capability.readable || capability.min == null || capability.max == null) {
                    snapshot = snapshotOf(Reading.Unavailable(UnavailableReason.UNSUPPORTED))
                } else if (capability.min != 0 || capability.max != 1) {
                    snapshot = snapshotOf(Reading.Unavailable(UnavailableReason.UNKNOWN))
                    report("unsupported position encoding; not interpreted as CLOSED")
                } else {
                    // Mark first: even a partially failed registration must be cleaned up.
                    current.registered = true
                    current.transport.subscribe(
                        { raw -> dispatcher.execute {
                            if (current.accepting) {
                                current.eventRevision++
                                publish(current, raw, "event")
                            }
                        } },
                        { error -> dispatcher.execute { if (current.accepting) fail(error, "listener") } },
                    )
                    report("listener registered (SDK call returned)")
                    val beforeRead = current.eventRevision
                    request<Int?>(current, { ok, fail -> current.transport.read(ok, fail) }) { raw ->
                        // A slow initial read must never replace a newer listener observation.
                        if (current.eventRevision == beforeRead) publish(current, raw, "current")
                        else report("late initial read ignored after event")
                    }
                }
            }
        } catch (error: Exception) {
            wanted = false
            fail(error, "initialize/subscribe", UnavailableReason.DISCONNECTED)
            session?.accepting = false
            finishClose()
        }
    }

    private fun <T> request(current: Session, operation: ((T) -> Unit, (Exception) -> Unit) -> Unit, complete: (T) -> Unit) {
        current.pending++
        var completed = false
        fun finish(value: T?, error: Exception?) = dispatcher.execute {
            if (!completed) {
                completed = true
                try {
                    if (current.accepting) {
                        if (error != null) fail(error, "request")
                        else {
                            @Suppress("UNCHECKED_CAST")
                            complete(value as T)
                        }
                    }
                } catch (failure: Exception) {
                    fail(failure, "callback/subscribe")
                } finally {
                    current.pending--
                    finishClose()
                }
            }
        }
        try { operation({ finish(it, null) }, { finish(null, it) }) }
        catch (error: Exception) { finish(null, error) }
    }

    private fun publish(current: Session, raw: Int?, kind: String) {
        val bounds = current.capability ?: return
        snapshot = snapshotOf(mapDoorPosition(raw, bounds.min, bounds.max, clock()))
        report("$kind raw=$raw · access=${bounds.access} range=${bounds.min}..${bounds.max}")
    }

    private fun fail(error: Exception, operation: String, fallback: UnavailableReason = UnavailableReason.UNKNOWN) {
        val reason = if (error is SecurityException) UnavailableReason.PERMISSION_DENIED else fallback
        snapshot = snapshotOf(Reading.Unavailable(reason))
        report("$operation $reason · ${error.javaClass.simpleName}: ${error.message}")
    }

    private fun stopSession() {
        snapshot = snapshotOf(Reading.Unavailable(UnavailableReason.DISCONNECTED))
        val current = session ?: return
        current.accepting = false
        if (current.registered) {
            current.registered = false
            try { current.transport.unsubscribe(); report("listener unregistered (SDK call returned)") }
            catch (error: Exception) { report("unregister failed: ${error.message}") }
        }
        report("stopping · pending=${current.pending}")
        finishClose()
    }

    private fun finishClose() {
        val current = session ?: return
        if (!current.accepting && current.pending == 0) {
            try { current.transport.release(); report("released") }
            catch (error: Exception) { report("release failed: ${error.message}") }
            session = null
            if (closed) dispatcher.close()
            else if (wanted) openSession()
        }
    }

    private fun report(message: String) {
        status = "PLEOS · ROW_1_LEFT · $message"
        log(status)
    }

    private fun snapshotOf(frontLeft: Reading<DoorPosition>) = VehicleSnapshot(
        DataOrigin.PLEOS,
        DoorId.entries.associateWith { if (it == DoorId.FRONT_LEFT) frontLeft else Reading.Unavailable(UnavailableReason.UNSUPPORTED) },
    )
}
