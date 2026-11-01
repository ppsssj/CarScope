package io.carscope.app.tire

import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.tire.*
import org.junit.Assert.*
import org.junit.Test

class PleosTireDataSourceTest {
    private class Worker : TireDispatcher {
        val queue = ArrayDeque<() -> Unit>()
        val timers = mutableListOf<Pair<BooleanArray, () -> Unit>>()
        var closed = false
        override fun execute(action: () -> Unit) { queue.add(action) }
        override fun after(delayMillis: Long, action: () -> Unit): () -> Unit {
            assertEquals(10_000L, delayMillis)
            val flag = booleanArrayOf(false); timers.add(flag to action)
            return { flag[0] = true }
        }
        override fun close() { closed = true }
        fun drain() { while (queue.isNotEmpty()) queue.removeFirst()() }
        fun timeout() { val pending = timers.toList(); timers.clear(); pending.filter { !it.first[0] }.forEach { it.second() }; drain() }
    }
    private class Call<T>(val ok: (T) -> Unit, val fail: (Exception) -> Unit)
    private class Fake : TireSession {
        var initializes = 0; var releases = 0
        var initError: Exception? = null; var subscribeError: Exception? = null; var unsubscribeError: Exception? = null
        var releaseError: Exception? = null
        val caps = mutableMapOf<TireFeature, Call<TireCapability?>>()
        val reads = mutableMapOf<Pair<TireFeature,TireId>, Call<Float?>>()
        val events = mutableMapOf<TireId, Call<Float?>>()
        val unregistered = mutableListOf<TireId>()
        override fun initialize() { initializes++; initError?.let { throw it } }
        override fun capability(feature: TireFeature, complete: (TireCapability?) -> Unit, failed: (Exception) -> Unit) { caps[feature] = Call(complete, failed) }
        override fun read(feature: TireFeature, tire: TireId, complete: (Float?) -> Unit, failed: (Exception) -> Unit) { reads[feature to tire] = Call(complete, failed) }
        override fun subscribe(tire: TireId, updated: (Float?) -> Unit, failed: (Exception) -> Unit) { events[tire] = Call(updated, failed); subscribeError?.let { throw it } }
        override fun unsubscribe(tire: TireId) { unregistered.add(tire); unsubscribeError?.let { throw it } }
        override fun release() { releases++; releaseError?.let { throw it } }
    }
    private class Fixture {
        val worker = Worker(); val sdk = Fake(); var time = 100L
        val logs = mutableListOf<String>()
        val source = PleosTireDataSource({ sdk }, worker, { time }, logs::add)
        init { source.start(); worker.drain() }
        fun cap(f: TireFeature, areas: Set<TireId> = TireId.entries.toSet(), readable: Boolean = true) {
            sdk.caps.getValue(f).ok(TireCapability(readable, areas, if (readable) "READ" else "NONE")); worker.drain()
        }
        fun ready(f: TireFeature = TireFeature.PRESSURE) { cap(f, setOf(TireId.FRONT_LEFT)); cap(if (f == TireFeature.PRESSURE) TireFeature.LOW_PRESSURE else TireFeature.PRESSURE, emptySet()) }
        fun row(f: TireFeature = TireFeature.PRESSURE, t: TireId = TireId.FRONT_LEFT) = source.readSnapshot().readings.single { it.feature == f && it.tire == t }
        fun reply(f: TireFeature = TireFeature.PRESSURE, raw: Float? = 123f) { sdk.reads.getValue(f to TireId.FRONT_LEFT).ok(raw); worker.drain() }
    }

    @Test fun `initial and duplicate starts never fabricate observations or duplicate sessions`() {
        val x=Fixture(); x.source.start(); x.worker.drain()
        assertEquals(1,x.sdk.initializes); assertEquals(2,x.sdk.caps.size)
        assertTrue(x.source.readSnapshot().readings.all { it.source==DataOrigin.PLEOS && it.value==null && it.capabilityStatus==TireStatus.UNVERIFIED })
    }
    @Test fun `read access and exact wheel presence gate every getter and pressure listener`() {
        val x=Fixture(); x.cap(TireFeature.PRESSURE,setOf(TireId.FRONT_LEFT,TireId.REAR_RIGHT)); x.cap(TireFeature.LOW_PRESSURE,readable=false)
        assertEquals(setOf(TireId.FRONT_LEFT,TireId.REAR_RIGHT),x.sdk.events.keys)
        assertEquals(2,x.sdk.reads.size)
        assertEquals(TireStatus.UNSUPPORTED,x.row(t=TireId.FRONT_RIGHT).availabilityStatus)
        assertTrue(x.source.readSnapshot().readings.filter { it.feature==TireFeature.LOW_PRESSURE }.all { it.value==null && it.capabilityStatus==TireStatus.UNSUPPORTED })
    }
    @Test fun `null capability denied capability and failed capability are distinct`() {
        val x=Fixture(); x.sdk.caps.getValue(TireFeature.PRESSURE).ok(null); x.sdk.caps.getValue(TireFeature.LOW_PRESSURE).fail(SecurityException("denied")); x.worker.drain()
        assertEquals(TireStatus.UNVERIFIED,x.row().capabilityStatus)
        assertEquals(TireStatus.PERMISSION_DENIED,x.row(TireFeature.LOW_PRESSURE).capabilityStatus)
        assertTrue(x.sdk.reads.isEmpty())
        val y=Fixture(); y.sdk.caps.getValue(TireFeature.PRESSURE).fail(Exception("query failed")); y.worker.drain()
        assertEquals(TireStatus.ERROR,y.row().capabilityStatus)
    }
    @Test fun `raw values have actual receipt time but no guessed unit or normal interpretation`() {
        val x=Fixture(); x.ready(); x.time=200; x.reply(raw=0f)
        val r=x.row(); assertEquals(TireStatus.SUPPORTED,r.capabilityStatus); assertEquals(TireStatus.UNVERIFIED,r.availabilityStatus)
        assertEquals(0f,r.value); assertNull(r.unit); assertEquals(200L,r.observedAt)
        x.time=5200; assertEquals(TireStatus.UNVERIFIED,x.row().availabilityStatus)
        x.time=5201; assertEquals(TireStatus.STALE,x.row().availabilityStatus); assertEquals(200L,x.row().observedAt)
    }
    @Test fun `null nan infinity and negative raw values never become zero or healthy`() {
        for (raw in listOf(null,Float.NaN,Float.POSITIVE_INFINITY,-1f)) {
            val x=Fixture(); x.ready(TireFeature.LOW_PRESSURE); x.reply(TireFeature.LOW_PRESSURE,raw)
            assertNull(x.row(TireFeature.LOW_PRESSURE).value); assertNull(x.row(TireFeature.LOW_PRESSURE).observedAt)
            assertEquals(if(raw==null) TireStatus.UNVERIFIED else TireStatus.ERROR,x.row(TireFeature.LOW_PRESSURE).availabilityStatus)
        }
    }
    @Test fun `low pressure getter is separate and has no invented listener`() {
        val x=Fixture(); x.ready(TireFeature.LOW_PRESSURE); x.reply(TireFeature.LOW_PRESSURE,12f)
        assertTrue(x.sdk.events.isEmpty()); assertEquals(12f,x.row(TireFeature.LOW_PRESSURE).value)
    }
    @Test fun `event wins over delayed initial getter and one shot callbacks are consumed once`() {
        val x=Fixture(); x.ready(); x.time=300; x.sdk.events.getValue(TireId.FRONT_LEFT).ok(200f); x.worker.drain()
        x.reply(raw=10f); x.sdk.reads.getValue(TireFeature.PRESSURE to TireId.FRONT_LEFT).fail(Exception("duplicate failed")); x.worker.drain()
        assertEquals(200f,x.row().value); assertEquals(300L,x.row().observedAt)
        assertTrue(x.logs.any { it.contains("late getter ignored") })
    }
    @Test fun `late getter failure cannot erase a newer event`() {
        val x=Fixture(); x.ready(); x.sdk.events.getValue(TireId.FRONT_LEFT).ok(200f); x.worker.drain()
        x.sdk.reads.getValue(TireFeature.PRESSURE to TireId.FRONT_LEFT).fail(Exception("old failure")); x.worker.drain()
        assertEquals(200f,x.row().value)
    }
    @Test fun `listener error invalidates data and older getter cannot restore it`() {
        val x=Fixture(); x.ready(); x.sdk.events.getValue(TireId.FRONT_LEFT).fail(SecurityException("revoked")); x.worker.drain(); x.reply()
        assertEquals(TireStatus.PERMISSION_DENIED,x.row().availabilityStatus); assertEquals(TireStatus.SUPPORTED,x.row().capabilityStatus); assertNull(x.row().value)
    }
    @Test fun `receipt time is taken at callback entry before worker queue delay`() {
        val x=Fixture(); x.ready(); x.time=200; x.sdk.reads.getValue(TireFeature.PRESSURE to TireId.FRONT_LEFT).ok(123f)
        x.time=4000; x.worker.drain(); assertEquals(200L,x.row().observedAt)
    }
    @Test fun `same valued real events remain new observations without creating new subscriptions`() {
        val x=Fixture(); x.ready(); val event=x.sdk.events.getValue(TireId.FRONT_LEFT)
        event.ok(123f); x.worker.drain(); x.time=500; event.ok(123f); x.worker.drain()
        assertEquals(500L,x.row().observedAt); assertEquals(1,x.sdk.events.size)
    }
    @Test fun `stop unregisters then waits for getter before release and ignores late events`() {
        val x=Fixture(); x.ready(); x.source.stop(); x.worker.drain()
        assertEquals(listOf(TireId.FRONT_LEFT),x.sdk.unregistered); assertEquals(0,x.sdk.releases)
        x.sdk.events.getValue(TireId.FRONT_LEFT).ok(200f); x.reply()
        assertNull(x.row().value); assertEquals(1,x.sdk.releases)
        x.source.close(); x.worker.drain(); assertTrue(x.worker.closed)
    }
    @Test fun `restart waits for prior SDK cleanup and never accepts prior owner callbacks`() {
        val x=Fixture(); x.ready(); val old=x.sdk.reads.getValue(TireFeature.PRESSURE to TireId.FRONT_LEFT)
        x.source.stop(); x.source.start(); x.worker.drain(); assertEquals(1,x.sdk.initializes)
        old.ok(99f); x.worker.drain(); assertEquals(2,x.sdk.initializes); assertNull(x.row().value)
        old.ok(88f); x.worker.drain(); assertNull(x.row().value)
    }
    @Test fun `timeouts publish ERROR without pretending SDK cancellation or release completed`() {
        val x=Fixture(); x.ready(); x.worker.timeout()
        assertEquals(TireStatus.ERROR,x.row().availabilityStatus); assertNull(x.row().value)
        x.source.close(); x.worker.drain(); assertEquals(0,x.sdk.releases); assertFalse(x.worker.closed)
        x.reply(raw=200f); assertNull(x.row().value); assertEquals(1,x.sdk.releases); assertTrue(x.worker.closed)
    }
    @Test fun `capability timeout is ERROR not UNSUPPORTED and duplicate completion cannot issue getters`() {
        val x=Fixture(); x.worker.timeout(); assertEquals(TireStatus.ERROR,x.row().capabilityStatus)
        x.cap(TireFeature.PRESSURE); x.cap(TireFeature.PRESSURE); assertTrue(x.sdk.reads.isEmpty())
    }
    @Test fun `partial registration failure is still cleaned and supported getter is attempted`() {
        val x=Fixture(); x.sdk.subscribeError=Exception("registration failed"); x.ready(); assertEquals(1,x.sdk.reads.size)
        x.sdk.unsubscribeError=Exception("cleanup failed"); x.source.stop(); x.worker.drain(); x.reply()
        assertEquals(1,x.sdk.unregistered.size); assertEquals(0,x.sdk.releases); assertTrue(x.logs.any { it.contains("unregister failed") })
        assertEquals("UNRESOLVED",x.source.diagnostics.phase)
        assertEquals(1,x.source.diagnostics.cleanupFailures)
        x.source.start(); x.worker.drain(); assertEquals(1,x.sdk.initializes)
    }
    @Test fun `initialize failures preserve real origin and do not switch to a mock`() {
        val sdk=Fake().apply { initError=SecurityException("bind denied") }; val worker=Worker()
        val source=PleosTireDataSource({sdk},worker,{100},{})
        source.start(); worker.drain()
        assertTrue(source.readSnapshot().readings.all { it.source==DataOrigin.PLEOS && it.availabilityStatus==TireStatus.PERMISSION_DENIED && it.value==null })
        assertEquals(1,sdk.releases)
    }
    @Test fun `duplicate capability success creates no duplicate reads or listeners`() {
        val x=Fixture(); x.ready(); val callback=x.sdk.caps.getValue(TireFeature.PRESSURE)
        callback.ok(TireCapability(true,TireId.entries.toSet(),"READ_WRITE")); x.worker.drain()
        assertEquals(1,x.sdk.events.size); assertEquals(1,x.sdk.reads.size)
    }
    @Test fun `combined areas stay unverified and are not called as fabricated single wheel support`() {
        val x=Fixture(); x.sdk.caps.getValue(TireFeature.PRESSURE).ok(TireCapability(true,emptySet(),"READ",setOf(TireId.FRONT_LEFT,TireId.FRONT_RIGHT))); x.worker.drain()
        assertEquals(TireStatus.UNVERIFIED,x.row().capabilityStatus); assertNull(x.row().value); assertTrue(x.sdk.reads.isEmpty())
        assertEquals(TireStatus.UNSUPPORTED,x.row(t=TireId.REAR_LEFT).capabilityStatus)
    }

    @Test fun `permanent silence retains actual requests and blocks unlimited recreate attempts`() {
        val x=Fixture(); val owner=TireProbeOwner(x.source)
        var lease=owner.attach(); owner.start(lease); x.worker.drain(); x.worker.timeout()
        repeat(50) {
            owner.stop(lease); owner.detach(lease)
            lease=owner.attach(); owner.start(lease); x.worker.drain()
        }
        val d=owner.diagnostics()
        assertEquals("UNRESOLVED",d.phase); assertEquals(2,d.pendingSdkRequests)
        assertEquals(2,d.timedOutSdkRequests); assertTrue(d.restartRequested)
        assertEquals(1,x.sdk.initializes); assertEquals(0,x.sdk.releases); assertFalse(x.worker.closed)
    }
    @Test fun `superseded Activity lease cannot stop or read the current session`() {
        val x=Fixture(); x.ready(); x.reply()
        val owner=TireProbeOwner(x.source); val old=owner.attach(); owner.start(old); x.worker.drain()
        val next=owner.attach(); owner.start(next); owner.stop(old); owner.detach(old); owner.start(old); x.worker.drain()
        assertFalse(owner.owns(old)); assertTrue(owner.owns(next))
        assertEquals(2,x.sdk.initializes); assertEquals(1,x.sdk.releases)
        x.ready(); x.reply(raw=7.25f)
        assertEquals(7.25f,owner.snapshot(next).readings.single { it.feature==TireFeature.PRESSURE && it.tire==TireId.FRONT_LEFT }.value)
        assertTrue(owner.snapshot(old).readings.all { it.value==null && it.reason=="OWNER_SUPERSEDED" })
        assertEquals("ACTIVE",owner.diagnostics().phase)
    }
    @Test fun `callback arriving after stop request never publishes and releases once`() {
        val x=Fixture(); x.ready(); x.source.stop()
        x.sdk.reads.getValue(TireFeature.PRESSURE to TireId.FRONT_LEFT).ok(99f)
        x.sdk.events.getValue(TireId.FRONT_LEFT).ok(88f)
        x.worker.drain(); x.source.stop(); x.source.close(); x.worker.drain()
        assertNull(x.row().value); assertEquals(1,x.sdk.releases); assertEquals("CLOSED",x.source.diagnostics.phase)
    }
    @Test fun `stop invalidates cache and already queued events before worker processes cleanup`() {
        val x=Fixture(); x.ready(); x.reply(raw=12f)
        x.sdk.events.getValue(TireId.FRONT_LEFT).ok(99f) // queued ahead of cleanup
        x.source.stop()
        assertTrue(x.source.diagnostics.stopRequested)
        assertNull(x.row().value) // no worker progress needed to hide the old observation
        x.worker.drain()
        assertNull(x.row().value); assertEquals(1,x.sdk.releases)
    }
    @Test fun `timeout then successful callback drains actual request without accepting raw value`() {
        val x=Fixture(); x.ready(); x.worker.timeout()
        assertEquals(1,x.source.diagnostics.pendingSdkRequests); assertEquals(1,x.source.diagnostics.timedOutSdkRequests)
        x.reply(raw=77f)
        assertEquals(0,x.source.diagnostics.pendingSdkRequests); assertEquals(0,x.source.diagnostics.timedOutSdkRequests)
        assertNull(x.row().value); assertEquals(TireStatus.ERROR,x.row().availabilityStatus)
        x.source.close(); x.worker.drain(); assertEquals(1,x.sdk.releases)
    }
    @Test fun `release exception quarantines session and is never retried or bypassed`() {
        val x=Fixture(); x.ready(); x.reply(); x.sdk.releaseError=Exception("release failed")
        x.source.stop(); x.source.start(); x.source.stop(); x.source.close(); x.worker.drain()
        assertEquals(1,x.sdk.releases); assertEquals(1,x.sdk.initializes)
        assertEquals("UNRESOLVED",x.source.diagnostics.phase); assertTrue(x.source.diagnostics.releaseAttempted)
        assertEquals(1,x.source.diagnostics.cleanupFailures); assertFalse(x.worker.closed)
    }
    @Test fun `permission denial can restart only after completed local release`() {
        val x=Fixture()
        TireFeature.entries.forEach { x.sdk.caps.getValue(it).fail(SecurityException("denied")) }; x.worker.drain()
        assertTrue(x.source.readSnapshot().readings.all { it.availabilityStatus==TireStatus.PERMISSION_DENIED })
        x.source.stop(); x.source.start(); x.worker.drain()
        assertEquals(1,x.sdk.releases); assertEquals(2,x.sdk.initializes)
        x.ready(); x.reply(raw=13.125f); assertEquals(13.125f,x.row().value); assertNull(x.row().unit)
    }
    @Test fun `late old capability after owner replacement cannot register listeners`() {
        val x=Fixture(); val owner=TireProbeOwner(x.source)
        val first=owner.attach(); owner.start(first); x.worker.drain()
        val old=x.sdk.caps.toMap()
        owner.detach(first); val second=owner.attach(); owner.start(second); x.worker.drain()
        old.values.forEach { it.ok(TireCapability(true,TireId.entries.toSet(),"READ")) }; x.worker.drain()
        assertTrue(x.sdk.events.isEmpty()); assertTrue(x.sdk.reads.isEmpty()); assertEquals(2,x.sdk.initializes)
        old.values.forEach { it.ok(TireCapability(true,TireId.entries.toSet(),"READ")) }; x.worker.drain()
        assertTrue(x.sdk.events.isEmpty()); assertEquals(1,x.sdk.releases)
    }
}
