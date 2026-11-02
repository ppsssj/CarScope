package io.carscope.app.component

import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** App test seam. No control operation or invented SDK cancellation method. */
internal interface ComponentSession {
    fun initialize()
    fun capability(feature: ComponentFeature, done: (ComponentCapability?) -> Unit, failed: (Exception) -> Unit)
    fun read(feature: ComponentFeature, done: (ComponentValue?) -> Unit, failed: (Exception) -> Unit)
    fun subscribe(feature: ComponentFeature, updated: (ComponentValue?) -> Unit, failed: (Exception) -> Unit)
    fun unsubscribe(feature: ComponentFeature)
    fun release()
}
internal interface ComponentDispatcher {
    fun execute(action: () -> Unit)
    fun after(ms: Long, action: () -> Unit): () -> Unit
    fun close()
}
internal class ComponentWorker : ComponentDispatcher {
    private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "CarScope-Components") }
    override fun execute(action: () -> Unit) { try { worker.execute(action) } catch (_: RejectedExecutionException) {} }
    override fun after(ms: Long, action: () -> Unit): () -> Unit { val f = worker.schedule(action, ms, TimeUnit.MILLISECONDS); return { f.cancel(false); Unit } }
    override fun close() { worker.shutdown() }
}
internal data class ComponentDiagnostics(val phase: String = "IDLE", val pending: Int = 0, val timedOut: Int = 0, val cleanupFailures: Int = 0)

internal class PleosComponentDataSource(
    private val factory: () -> ComponentSession, private val worker: ComponentDispatcher = ComponentWorker(),
    private val clock: () -> Long = System::currentTimeMillis
) {
    private class Session(val sdk: ComponentSession, val epoch: Long) {
        var accepting = true; var pending = 0; var timedOut = 0; var cleanupFailures = 0; var releaseAttempted = false
        val registrations = mutableSetOf<ComponentFeature>()
        val revisions = ComponentFeature.entries.associateWith { 0L }.toMutableMap()
        val capabilities = mutableMapOf<ComponentFeature, ComponentCapability>()
    }
    private val epoch = AtomicLong()
    private var session: Session? = null
    private var wanted = false; private var closed = false; private var workerClosed = false
    @Volatile private var snapshot = ComponentSnapshot.empty()
    @Volatile private var snapshotEpoch = 0L
    @Volatile var diagnostics = ComponentDiagnostics(); private set
    fun readSnapshot() = if (snapshotEpoch == epoch.get()) snapshot.at(clock()) else ComponentSnapshot.empty("SESSION_STOPPED")
    fun start() = worker.execute { if (!closed) { wanted = true; if (session == null) open() } }
    fun stop() { epoch.incrementAndGet(); worker.execute { wanted = false; stopSession(); diagnose() } }
    fun close() { epoch.incrementAndGet(); worker.execute { closed = true; wanted = false; stopSession(); if (session == null) closeWorker(); diagnose() } }
    private fun closeWorker() { if (!workerClosed) { workerClosed = true; worker.close() } }
    private fun accepts(s: Session) = s.accepting && s.epoch == epoch.get()
    private fun diagnose() {
        val s = session
        diagnostics = ComponentDiagnostics(when { s == null -> if (closed) "CLOSED" else "IDLE"; s.cleanupFailures > 0 || s.timedOut > 0 || (!s.accepting && s.pending > 0) -> "UNRESOLVED"; !s.accepting -> "STOPPING"; else -> "ACTIVE" }, s?.pending ?: 0, s?.timedOut ?: 0, s?.cleanupFailures ?: 0)
    }
    private fun open() {
        snapshot = ComponentSnapshot.empty()
        snapshotEpoch = epoch.get()
        val s = try { Session(factory(), epoch.get()) } catch (e: Exception) { ComponentFeature.entries.forEach { fail(it, e, true) }; wanted = false; diagnose(); return }
        session = s; snapshotEpoch = s.epoch
        try {
            s.sdk.initialize()
            for (f in ComponentFeature.entries) request<ComponentCapability?>(s, { done, failed -> s.sdk.capability(f, done, failed) }, { fail(f, it, true) }) { cap, _ ->
                when {
                    cap == null -> reset(f, ComponentStatus.UNVERIFIED, "NULL_CAPABILITY")
                    !cap.readable -> reset(f, ComponentStatus.UNSUPPORTED, "NO_READ_CAPABILITY")
                    (f == ComponentFeature.BRAKE || f in VISIBILITY_UI_V1) && cap.values == null -> reset(f, ComponentStatus.UNVERIFIED, "NULL_CAPABILITY_VALUES")
                    (f == ComponentFeature.BRAKE || f in VISIBILITY_UI_V1) && cap.values!!.isEmpty() -> reset(f, ComponentStatus.UNSUPPORTED, "NO_SUPPORTED_VALUES")
                    else -> {
                        s.capabilities[f] = cap.copy(values = cap.values?.toSet())
                        change(f) { it.copy(capabilityStatus = ComponentStatus.SUPPORTED, reason = "AWAITING_VALUE") }
                        if (f.subscribed) {
                            s.registrations.add(f)
                            try { s.sdk.subscribe(f, { value -> val at = clock(); worker.execute { if (accepts(s)) { s.revisions[f] = s.revisions.getValue(f) + 1; publish(s, f, value, at) } } },
                                { error -> worker.execute { if (accepts(s)) { s.revisions[f] = s.revisions.getValue(f) + 1; fail(f, error, false) } } }) }
                            catch (e: Exception) { fail(f, e, false) }
                        }
                        val revision = s.revisions.getValue(f)
                        request<ComponentValue?>(s, { done, failed -> s.sdk.read(f, done, failed) }, { if (revision == s.revisions[f]) fail(f, it, false) }) { value, at -> if (revision == s.revisions[f]) publish(s, f, value, at) }
                    }
                }
            }
            diagnose()
        } catch (e: Exception) { ComponentFeature.entries.forEach { fail(it, e, true) }; wanted = false; stopSession(clear = false) }
    }
    private fun <T> request(s: Session, operation: ((T) -> Unit, (Exception) -> Unit) -> Unit, failure: (Exception) -> Unit, done: (T, Long) -> Unit) {
        s.pending++; diagnose(); var consumed = false; var timeout = false
        val cancel = worker.after(10_000) { if (!consumed) { timeout = true; s.timedOut++; if (accepts(s)) failure(java.util.concurrent.TimeoutException()); diagnose() } }
        fun finish(value: T?, error: Exception?) {
            val at = clock()
            worker.execute { if (!consumed) {
                consumed = true; cancel()
                try { if (accepts(s) && !timeout) { if (error != null) failure(error) else { @Suppress("UNCHECKED_CAST") done(value as T, at) } } }
                finally { s.pending--; if (timeout) s.timedOut--; finishClose(); diagnose() }
            } }
        }
        try { operation({ finish(it, null) }, { finish(null, it) }) } catch (e: Exception) { finish(null, e) }
    }
    private fun publish(s: Session, f: ComponentFeature, value: ComponentValue?, at: Long) {
        val valid = when (f) {
            ComponentFeature.WASHER, ComponentFeature.CHARGE_SWITCH, ComponentFeature.CHARGE_PORT -> value is ComponentValue.Flag
            ComponentFeature.BRAKE -> value is ComponentValue.Oil && value.value in OIL_STATES && value.value in (s.capabilities[f]?.values ?: emptySet())
            ComponentFeature.SOC -> value is ComponentValue.Integer
            ComponentFeature.WIPER_FRONT -> value is ComponentValue.Mode && value.value in WIPER_STATES && value.value in (s.capabilities[f]?.values ?: emptySet())
            ComponentFeature.LOW_BEAM, ComponentFeature.HIGH_BEAM -> value is ComponentValue.Mode && value.value in LIGHT_STATES && value.value in (s.capabilities[f]?.values ?: emptySet())
        }
        val status = when { at < 0 || at > 8_640_000_000_000_000L -> ComponentStatus.ERROR; value == null -> ComponentStatus.UNAVAILABLE; value == ComponentValue.Oil("ERROR") -> ComponentStatus.ERROR; !valid -> ComponentStatus.UNVERIFIED; f == ComponentFeature.SOC || f == ComponentFeature.WIPER_FRONT && value == ComponentValue.Mode("OTHER") -> ComponentStatus.UNVERIFIED; else -> ComponentStatus.SUPPORTED }
        val observed = valid && status in setOf(ComponentStatus.SUPPORTED, ComponentStatus.UNVERIFIED)
        change(f) { it.copy(availabilityStatus = status, value = if (observed) value else null, observedAt = if (observed) at else null, reason = if (f == ComponentFeature.SOC && observed) "INTEGER_UNIT_AND_RANGE_UNVERIFIED" else status.name) }
    }
    private fun fail(f: ComponentFeature, error: Exception, capability: Boolean) {
        val status = if (error is SecurityException) ComponentStatus.PERMISSION_DENIED else ComponentStatus.ERROR
        change(f) { it.copy(capabilityStatus = if (capability) status else it.capabilityStatus, availabilityStatus = status, value = null, observedAt = null, reason = status.name) }
    }
    private fun reset(f: ComponentFeature, status: ComponentStatus, reason: String) = change(f) { ComponentReading(f, status, status, reason = reason) }
    private fun change(f: ComponentFeature, edit: (ComponentReading) -> ComponentReading) { snapshot = ComponentSnapshot(snapshot.readings.mapValues { (key, value) -> if (key == f) edit(value) else value }) }
    private fun stopSession(clear: Boolean = true) {
        if (clear) snapshot = ComponentSnapshot.empty("SESSION_STOPPED")
        val s = session ?: return
        s.accepting = false
        for (f in s.registrations) try { s.sdk.unsubscribe(f) } catch (_: Exception) { s.cleanupFailures++ }
        s.registrations.clear(); finishClose(); diagnose()
    }
    private fun finishClose() {
        val s = session ?: return
        if (!s.accepting && s.pending == 0 && s.cleanupFailures == 0 && !s.releaseAttempted) {
            s.releaseAttempted = true
            try { s.sdk.release() } catch (_: Exception) { s.cleanupFailures++; diagnose(); return }
            session = null
            if (closed) closeWorker() else if (wanted) open()
        }
    }
}
