package io.carscope.app.component

import org.junit.Assert.*
import org.junit.Test

internal class ComponentTestWorker : ComponentDispatcher {
    val queue = ArrayDeque<() -> Unit>()
    private val timers = mutableListOf<Pair<() -> Unit, BooleanArray>>()
    var closes = 0
    override fun execute(action: () -> Unit) { queue.addLast(action) }
    override fun after(ms: Long, action: () -> Unit): () -> Unit { val cancelled = booleanArrayOf(false); timers.add(action to cancelled); return { cancelled[0] = true } }
    override fun close() { closes++ }
    fun drain() { while (queue.isNotEmpty()) queue.removeFirst()() }
    fun timeout() { val pending = timers.toList(); timers.clear(); pending.filter { !it.second[0] }.forEach { it.first() }; drain() }
}
internal class ComponentFakeSession : ComponentSession {
    val capabilities = mutableMapOf<ComponentFeature, Pair<(ComponentCapability?) -> Unit, (Exception) -> Unit>>()
    val getters = mutableMapOf<ComponentFeature, Pair<(ComponentValue?) -> Unit, (Exception) -> Unit>>()
    val events = mutableMapOf<ComponentFeature, Pair<(ComponentValue?) -> Unit, (Exception) -> Unit>>()
    val unregistered = mutableListOf<ComponentFeature>()
    var initialized = 0; var released = 0; var unregisterFails = false; var releaseFails = false; var initFails = false
    override fun initialize() { initialized++; if (initFails) throw IllegalStateException("fixture") }
    override fun capability(feature: ComponentFeature, done: (ComponentCapability?) -> Unit, failed: (Exception) -> Unit) { capabilities[feature] = done to failed }
    override fun read(feature: ComponentFeature, done: (ComponentValue?) -> Unit, failed: (Exception) -> Unit) { getters[feature] = done to failed }
    override fun subscribe(feature: ComponentFeature, updated: (ComponentValue?) -> Unit, failed: (Exception) -> Unit) { check(feature.subscribed); events[feature] = updated to failed }
    override fun unsubscribe(feature: ComponentFeature) { unregistered.add(feature); if (unregisterFails) throw IllegalStateException("fixture") }
    override fun release() { released++; if (releaseFails) throw IllegalStateException("fixture") }
}
class PleosComponentDataSourceTest {
    private class Fixture {
        val worker = ComponentTestWorker(); var at = 1000L; val sessions = mutableListOf<ComponentFakeSession>()
        val source = PleosComponentDataSource({ ComponentFakeSession().also(sessions::add) }, worker, { at })
        val sdk get() = sessions.first()
        init { source.start(); worker.drain() }
        fun cap(f: ComponentFeature, c: ComponentCapability? = ComponentCapability(true, if (f == ComponentFeature.BRAKE) OIL_STATES else null)) { sdk.capabilities.getValue(f).first(c); worker.drain() }
        fun ready() { ComponentFeature.entries.forEach { cap(it) } }
        fun value(f: ComponentFeature, v: ComponentValue?) { sdk.getters.getValue(f).first(v); worker.drain() }
        fun values() { ready(); value(ComponentFeature.WASHER, ComponentValue.Flag(false)); value(ComponentFeature.BRAKE, ComponentValue.Oil("NORMAL")); value(ComponentFeature.SOC, ComponentValue.Integer(42)); value(ComponentFeature.CHARGE_SWITCH, ComponentValue.Flag(false)) }
        fun row(f: ComponentFeature) = source.readSnapshot().readings.getValue(f)
    }
    @Test fun `initial and capability states do not fabricate values or getter calls`() {
        val f = Fixture(); assertEquals(4, f.source.diagnostics.pending)
        assertTrue(f.source.readSnapshot().readings.values.all { it.capabilityStatus == ComponentStatus.UNVERIFIED && it.value == null && it.source == "PLEOS" })
        f.cap(ComponentFeature.WASHER, null); f.cap(ComponentFeature.BRAKE, ComponentCapability(false, OIL_STATES))
        f.cap(ComponentFeature.SOC, ComponentCapability(false)); f.cap(ComponentFeature.CHARGE_SWITCH)
        assertEquals(ComponentStatus.UNVERIFIED, f.row(ComponentFeature.WASHER).capabilityStatus)
        assertEquals(ComponentStatus.UNSUPPORTED, f.row(ComponentFeature.BRAKE).capabilityStatus)
        assertEquals(setOf(ComponentFeature.CHARGE_SWITCH), f.sdk.getters.keys); assertTrue(f.sdk.events.isEmpty())
        val noRead = Fixture(); noRead.cap(ComponentFeature.BRAKE, ComponentCapability(false))
        assertEquals(ComponentStatus.UNSUPPORTED, noRead.row(ComponentFeature.BRAKE).capabilityStatus)
    }
    @Test fun `typed reports preserve source timestamps false and unverified SOC without health inference`() {
        val f = Fixture(); f.values()
        assertEquals(ComponentValue.Flag(false), f.row(ComponentFeature.WASHER).value)
        assertEquals(ComponentValue.Oil("NORMAL"), f.row(ComponentFeature.BRAKE).value)
        assertEquals(ComponentStatus.UNVERIFIED, f.row(ComponentFeature.SOC).availabilityStatus)
        assertEquals(ComponentValue.Integer(42), f.row(ComponentFeature.SOC).value)
        assertTrue(f.source.readSnapshot().readings.values.all { it.observedAt == 1000L && it.source == "PLEOS" })
        assertFalse(f.sdk.events.containsKey(ComponentFeature.CHARGE_SWITCH))
    }
    @Test fun `null unknown ERROR and mismatched types never become normal reports`() {
        val f = Fixture(); f.ready()
        f.value(ComponentFeature.WASHER, null); f.value(ComponentFeature.BRAKE, ComponentValue.Oil("UNKNOWN"))
        f.value(ComponentFeature.SOC, ComponentValue.Flag(false))
        assertEquals(ComponentStatus.UNAVAILABLE, f.row(ComponentFeature.WASHER).availabilityStatus)
        assertEquals(ComponentStatus.UNVERIFIED, f.row(ComponentFeature.BRAKE).availabilityStatus)
        assertNull(f.row(ComponentFeature.BRAKE).observedAt); assertNull(f.row(ComponentFeature.SOC).value)
        f.sdk.events.getValue(ComponentFeature.BRAKE).first(ComponentValue.Oil("ERROR")); f.worker.drain()
        assertEquals(ComponentStatus.ERROR, f.row(ComponentFeature.BRAKE).availabilityStatus); assertNull(f.row(ComponentFeature.BRAKE).value)
    }
    @Test fun `brake observation must be advertised by capability`() {
        val f = Fixture(); f.cap(ComponentFeature.BRAKE, ComponentCapability(true, setOf("LOW")))
        f.value(ComponentFeature.BRAKE, ComponentValue.Oil("NORMAL")); assertNull(f.row(ComponentFeature.BRAKE).value)
        f.sdk.events.getValue(ComponentFeature.BRAKE).first(ComponentValue.Oil("LOW")); f.worker.drain()
        assertEquals(ComponentValue.Oil("LOW"), f.row(ComponentFeature.BRAKE).value)
    }
    @Test fun `stale boundary and cache reads never advance observedAt or call the SDK again`() {
        val f = Fixture(); f.values(); f.at = 6000
        assertEquals(ComponentStatus.SUPPORTED, f.row(ComponentFeature.WASHER).availabilityStatus)
        f.at = 6001; assertEquals(ComponentStatus.STALE, f.row(ComponentFeature.WASHER).availabilityStatus)
        repeat(50) { f.source.readSnapshot() }
        assertEquals(1000L, f.row(ComponentFeature.WASHER).observedAt); assertEquals(4, f.sdk.getters.size)
        f.at = 999; assertEquals(ComponentStatus.ERROR, f.row(ComponentFeature.WASHER).availabilityStatus); assertNull(f.row(ComponentFeature.WASHER).value)
    }
    @Test fun `callback receipt time is captured before worker queueing`() {
        val f = Fixture(); f.ready(); f.sdk.getters.getValue(ComponentFeature.WASHER).first(ComponentValue.Flag(true))
        f.at = 2000; f.worker.drain(); assertEquals(1000L, f.row(ComponentFeature.WASHER).observedAt)
    }
    @Test fun `newer event or event failure defeats a late initial getter`() {
        val f = Fixture(); f.ready()
        f.sdk.events.getValue(ComponentFeature.WASHER).first(ComponentValue.Flag(true)); f.sdk.getters.getValue(ComponentFeature.WASHER).first(ComponentValue.Flag(false)); f.worker.drain()
        assertEquals(ComponentValue.Flag(true), f.row(ComponentFeature.WASHER).value)
        f.sdk.events.getValue(ComponentFeature.BRAKE).second(SecurityException()); f.sdk.getters.getValue(ComponentFeature.BRAKE).first(ComponentValue.Oil("NORMAL")); f.worker.drain()
        assertEquals(ComponentStatus.PERMISSION_DENIED, f.row(ComponentFeature.BRAKE).availabilityStatus); assertNull(f.row(ComponentFeature.BRAKE).value)
    }
    @Test fun `permission failures keep capability and availability independent`() {
        val f = Fixture(); f.sdk.capabilities.getValue(ComponentFeature.WASHER).second(SecurityException()); f.worker.drain()
        assertEquals(ComponentStatus.PERMISSION_DENIED, f.row(ComponentFeature.WASHER).capabilityStatus)
        f.cap(ComponentFeature.BRAKE); f.sdk.getters.getValue(ComponentFeature.BRAKE).second(SecurityException()); f.worker.drain()
        assertEquals(ComponentStatus.SUPPORTED, f.row(ComponentFeature.BRAKE).capabilityStatus)
        assertEquals(ComponentStatus.PERMISSION_DENIED, f.row(ComponentFeature.BRAKE).availabilityStatus)
    }
    @Test fun `duplicate completion failure is consumed once and pending cannot go negative`() {
        val f = Fixture(); f.values(); val done = f.sdk.getters.getValue(ComponentFeature.WASHER)
        done.first(ComponentValue.Flag(true)); done.second(IllegalStateException()); f.worker.drain()
        assertEquals(0, f.source.diagnostics.pending); assertEquals(ComponentValue.Flag(false), f.row(ComponentFeature.WASHER).value)
    }
    @Test fun `timeout is not cancellation and late callbacks drain before one restart`() {
        val f = Fixture(); f.worker.timeout(); assertEquals(4, f.source.diagnostics.pending); assertEquals(4, f.source.diagnostics.timedOut)
        f.source.stop(); assertTrue(f.source.readSnapshot().readings.values.all { it.value == null }); f.worker.drain()
        repeat(50) { f.source.start(); f.worker.drain() }; assertEquals(1, f.sessions.size)
        f.sdk.capabilities.values.toList().forEach { it.first(ComponentCapability(true, OIL_STATES)) }; f.worker.drain()
        assertEquals(1, f.sdk.released); assertTrue(f.sdk.getters.isEmpty()); assertEquals(2, f.sessions.size)
    }
    @Test fun `stop immediately hides queued events and superseded callbacks cannot republish`() {
        val f = Fixture(); f.values(); f.sdk.events.getValue(ComponentFeature.WASHER).first(ComponentValue.Flag(true))
        f.source.stop(); assertNull(f.row(ComponentFeature.WASHER).value); f.worker.drain()
        assertNull(f.row(ComponentFeature.WASHER).value); assertEquals(1, f.sdk.released); assertEquals(3, f.sdk.unregistered.size)
    }
    @Test fun `cleanup and release failures quarantine the old session and block repeated initialization`() {
        for (release in listOf(false, true)) {
            val f = Fixture(); f.values(); if (release) f.sdk.releaseFails = true else f.sdk.unregisterFails = true
            f.source.stop(); f.worker.drain(); repeat(10) { f.source.start(); f.worker.drain() }
            assertEquals("UNRESOLVED", f.source.diagnostics.phase); assertEquals(1, f.sessions.size); assertEquals(if (release) 1 else 0, f.sdk.released)
        }
    }
    @Test fun `close waits for actual callbacks and closes worker exactly once`() {
        val f = Fixture(); f.source.close(); f.worker.drain(); assertEquals(0, f.worker.closes)
        f.sdk.capabilities.values.toList().forEach { it.first(ComponentCapability(true)) }; f.worker.drain()
        assertEquals(1, f.worker.closes); assertEquals("CLOSED", f.source.diagnostics.phase); assertTrue(f.sdk.getters.isEmpty())
    }
    @Test fun `factory failure is unavailable not a silent mock and snapshot is immutable`() {
        val worker = ComponentTestWorker(); val source = PleosComponentDataSource({ throw SecurityException() }, worker)
        source.start(); worker.drain(); assertTrue(source.readSnapshot().readings.values.all { it.source == "PLEOS" && it.capabilityStatus == ComponentStatus.PERMISSION_DENIED })
        assertThrows(UnsupportedOperationException::class.java) { (source.readSnapshot().readings as MutableMap).clear() }
    }
}
