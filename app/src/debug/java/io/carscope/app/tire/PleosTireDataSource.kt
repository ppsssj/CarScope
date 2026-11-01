package io.carscope.app.tire

import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.tire.*
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

internal data class TireCapability(val readable: Boolean, val areas: Set<TireId>, val access: String, val unverifiedAreas: Set<TireId> = emptySet())

/** App-owned test seam, not an invented SDK API. No vehicle control operations. */
internal interface TireSession {
    fun initialize()
    fun capability(feature: TireFeature, complete: (TireCapability?) -> Unit, failed: (Exception) -> Unit)
    fun read(feature: TireFeature, tire: TireId, complete: (Float?) -> Unit, failed: (Exception) -> Unit)
    fun subscribe(tire: TireId, updated: (Float?) -> Unit, failed: (Exception) -> Unit)
    fun unsubscribe(tire: TireId)
    fun release()
}

internal interface TireDispatcher {
    fun execute(action: () -> Unit)
    fun after(delayMillis: Long, action: () -> Unit): () -> Unit
    fun close()
}

internal class TireWorker : TireDispatcher {
    private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "CarScope-Tire") }
    override fun execute(action: () -> Unit) { try { worker.execute(action) } catch (_: RejectedExecutionException) { } }
    override fun after(delayMillis: Long, action: () -> Unit): () -> Unit {
        val future = worker.schedule(action, delayMillis, TimeUnit.MILLISECONDS)
        return { future.cancel(false); Unit }
    }
    override fun close() { worker.shutdown() }
}

/** Local bookkeeping only; IDLE/CLOSED never assert remote service acknowledgement. */
internal data class TireSessionDiagnostics(
    val phase: String = "IDLE", val pendingSdkRequests: Int = 0, val timedOutSdkRequests: Int = 0,
    val cleanupFailures: Int = 0, val releaseAttempted: Boolean = false, val restartRequested: Boolean = false,
    val stopRequested: Boolean = false,
)

/** Serialized asynchronous cache. A stop invalidates ownership before unregistering anything. */
internal class PleosTireDataSource(
    private val factory: () -> TireSession,
    private val worker: TireDispatcher = TireWorker(),
    private val clock: () -> Long = System::currentTimeMillis,
    private val log: (String) -> Unit = {},
) : TireDataSource {
    private class Session(val sdk: TireSession, val epoch: Long) {
        var accepting = true
        var pending = 0
        var timedOut = 0
        var cleanupFailures = 0
        var releaseAttempted = false
        val registrations = mutableSetOf<TireId>()
        val revisions = TireId.entries.associateWith { 0L }.toMutableMap()
    }
    private var session: Session? = null
    private var wanted = false
    private var closed = false
    private val epoch = AtomicLong()
    @Volatile private var snapshotEpoch = 0L
    @Volatile private var snapshot = TireSnapshot.empty(DataOrigin.PLEOS)
    @Volatile private var stopRequested = false
    @Volatile private var sessionDiagnostics = TireSessionDiagnostics()
    val diagnostics get() = sessionDiagnostics.copy(stopRequested = stopRequested)
    override fun readSnapshot() = if (snapshotEpoch == epoch.get()) snapshot.at(clock())
        else TireSnapshot.empty(DataOrigin.PLEOS, "SESSION_STOPPED")

    fun start() = worker.execute { if (!closed) { wanted = true; if (session == null) open(); diagnose() } }
    fun stop() { stopRequested = true; epoch.incrementAndGet(); worker.execute { wanted = false; stopSession(); diagnose() } }
    fun close() { stopRequested = true; epoch.incrementAndGet(); worker.execute { closed = true; wanted = false; stopSession(); diagnose(); if (session == null) worker.close() } }
    private fun accepts(s: Session) = s.accepting && s.epoch == epoch.get()

    private fun diagnose() {
        val s = session
        sessionDiagnostics = TireSessionDiagnostics(
            phase = when {
                s == null -> if (closed) "CLOSED" else "IDLE"
                s.cleanupFailures > 0 || s.timedOut > 0 || (!s.accepting && s.pending > 0) -> "UNRESOLVED"
                !s.accepting -> "STOPPING"
                else -> "ACTIVE"
            }, pendingSdkRequests = s?.pending ?: 0, timedOutSdkRequests = s?.timedOut ?: 0,
            cleanupFailures = s?.cleanupFailures ?: 0, releaseAttempted = s?.releaseAttempted ?: false,
            restartRequested = wanted && s?.accepting == false,
        )
    }

    private fun open() {
        snapshot = TireSnapshot.empty(DataOrigin.PLEOS)
        try {
            val s = Session(factory(), epoch.get()); session = s; snapshotEpoch = s.epoch; stopRequested = false
            s.sdk.initialize()
            log("initialize returned; connection UNVERIFIED until a callback")
            for (feature in TireFeature.entries) request<TireCapability?>(s,
                { ok, fail -> s.sdk.capability(feature, ok, fail) },
                { error -> fail(feature, null, error, true) },
            ) { cap, _ ->
                log("capability ${feature.featureId} access=${cap?.access} areas=${cap?.areas}")
                for (tire in TireId.entries) {
                    when {
                        cap == null -> update(feature, tire, TireStatus.UNVERIFIED, TireStatus.UNVERIFIED, "NULL_CAPABILITY")
                        !cap.readable -> update(feature, tire, TireStatus.UNSUPPORTED, TireStatus.UNSUPPORTED, "NO_READ_ACCESS")
                        tire in cap.unverifiedAreas && tire !in cap.areas -> update(feature, tire, TireStatus.UNVERIFIED, TireStatus.UNVERIFIED, "COMBINED_WHEEL_AREA_UNVERIFIED")
                        tire !in cap.areas -> update(feature, tire, TireStatus.UNSUPPORTED, TireStatus.UNSUPPORTED, "AREA_NOT_ADVERTISED")
                        else -> {
                            update(feature, tire, TireStatus.SUPPORTED, TireStatus.UNVERIFIED, "AWAITING_VALUE")
                            if (feature == TireFeature.PRESSURE) {
                                s.registrations.add(tire) // also clean up a partially failed registration
                                try {
                                    s.sdk.subscribe(tire, { raw ->
                                        val receivedAt = clock()
                                        worker.execute { if (accepts(s)) { s.revisions[tire] = s.revisions.getValue(tire) + 1; publish(feature, tire, raw, receivedAt, "EVENT") } }
                                    }, { error -> worker.execute { if (accepts(s)) { s.revisions[tire] = s.revisions.getValue(tire) + 1; fail(feature, tire, error, false) } } })
                                    log("registered ${tire.vehiclePartId}; SDK call returned")
                                } catch (e: Exception) { log("subscribe failed ${tire.vehiclePartId}: ${e.javaClass.simpleName}: ${e.message}") }
                            }
                            val revision = s.revisions.getValue(tire)
                            request<Float?>(s, { ok, fail -> s.sdk.read(feature, tire, ok, fail) },
                                { error -> if (feature != TireFeature.PRESSURE || revision == s.revisions[tire]) fail(feature, tire, error, false) },
                            ) { raw, receivedAt ->
                                if (feature != TireFeature.PRESSURE || revision == s.revisions[tire]) publish(feature, tire, raw, receivedAt, "GET")
                                else log("late getter ignored ${tire.vehiclePartId}")
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            for (f in TireFeature.entries) fail(f, null, e, true)
            wanted = false
            stopSession(invalidate = false)
        }
    }

    private fun <T> request(s: Session, operation: ((T) -> Unit, (Exception) -> Unit) -> Unit,
                            failure: (Exception) -> Unit, complete: (T, Long) -> Unit) {
        s.pending++; diagnose()
        var consumed = false
        var timedOut = false
        val cancel = worker.after(REQUEST_TIMEOUT_MILLIS) {
            if (!consumed) {
                timedOut = true; s.timedOut++; diagnose()
                if (accepts(s)) failure(java.util.concurrent.TimeoutException("SDK callback not received in ${REQUEST_TIMEOUT_MILLIS}ms"))
                log("callback timeout; SDK request remains pending (no public cancellation API)")
            }
        }
        fun finish(value: T?, error: Exception?) {
            val receivedAt = clock()
            worker.execute {
                if (!consumed) {
                    consumed = true; cancel()
                    try {
                        if (accepts(s) && !timedOut) {
                            if (error != null) failure(error)
                            else { @Suppress("UNCHECKED_CAST") complete(value as T, receivedAt) }
                        }
                    } finally { s.pending--; if (timedOut) s.timedOut--; finishClose(); diagnose() }
                }
            }
        }
        try { operation({ finish(it, null) }, { finish(null, it) }) } catch (e: Exception) { finish(null, e) }
    }

    private fun publish(feature: TireFeature, tire: TireId, raw: Float?, time: Long, kind: String) {
        val valid = raw != null && raw.isFinite() && raw >= 0 && time >= 0
        val status = if (raw == null) TireStatus.UNVERIFIED else if (!valid) TireStatus.ERROR else TireStatus.UNVERIFIED
        change(feature, tire) { it.copy(availabilityStatus = status, value = if (valid) raw else null, observedAt = if (valid) time else null,
            reason = if (valid) "RAW_FLOAT_UNIT_AND_SEMANTICS_UNVERIFIED" else if (raw == null) "NULL_VALUE" else "INVALID_VALUE_OR_CLOCK") }
        log("$kind ${feature.featureId} ${tire.vehiclePartId} raw=$raw receivedAt=$time unit=UNVERIFIED")
    }
    private fun fail(feature: TireFeature, tire: TireId?, error: Exception, capability: Boolean) {
        val status = if (error is SecurityException) TireStatus.PERMISSION_DENIED else TireStatus.ERROR
        for (id in if (tire == null) TireId.entries else listOf(tire)) change(feature, id) {
            it.copy(capabilityStatus = if (capability) status else it.capabilityStatus, availabilityStatus = status,
                value = null, observedAt = null, reason = error.javaClass.simpleName + ": " + error.message)
        }
        log("failed ${feature.featureId} ${tire?.vehiclePartId} $status ${error.javaClass.simpleName}: ${error.message}")
    }
    private fun update(f: TireFeature, t: TireId, cap: TireStatus, availability: TireStatus, reason: String) = change(f, t) {
        it.copy(capabilityStatus = cap, availabilityStatus = availability, value = null, observedAt = null, reason = reason)
    }
    private fun change(f: TireFeature, t: TireId, edit: (TireReading) -> TireReading) {
        snapshot = TireSnapshot(snapshot.readings.map { if (it.feature == f && it.tire == t) edit(it) else it })
    }
    private fun stopSession(invalidate: Boolean = true) {
        if (invalidate) snapshot = TireSnapshot.empty(DataOrigin.PLEOS, "SESSION_STOPPED")
        val s = session ?: return
        s.accepting = false
        diagnose()
        for (t in s.registrations.toList()) {
            try { s.sdk.unsubscribe(t); log("unsubscribe attempt returned ${t.vehiclePartId}; remote acknowledgement UNVERIFIED") }
            catch (e: Exception) { s.cleanupFailures++; log("unregister failed ${t.vehiclePartId}: ${e.message}; cleanup UNRESOLVED") }
        }
        s.registrations.clear()
        log("stopping pending=${s.pending}")
        finishClose()
    }
    private fun finishClose() {
        val s = session ?: return
        if (!s.accepting && s.pending == 0 && s.cleanupFailures == 0 && !s.releaseAttempted) {
            s.releaseAttempted = true
            diagnose()
            try { s.sdk.release(); log("release returned; Service acknowledgement UNVERIFIED") }
            catch (e: Exception) { s.cleanupFailures++; diagnose(); log("release failed: ${e.message}; cleanup UNRESOLVED"); return }
            session = null
            if (closed) worker.close() else if (wanted) open()
        }
    }
    companion object { const val REQUEST_TIMEOUT_MILLIS = 10_000L }
}
