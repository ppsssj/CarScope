package io.carscope.app.sync

import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import com.google.gson.JsonParser
import io.carscope.app.lab.InspectionActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import java.util.concurrent.TimeUnit

/** The 3D request path with the real simulator credential source. The server, grant exchange and sessions are synthetic. */
class MobileFlowActivity : InspectionActivity() {
    internal val fake = ActivityFakeTransport()
    internal val exchange = PendingAvdSimulatorExchange()
    internal var clock = 2100L
    internal var created = 0
    override fun now() = clock
    override fun endpoint() = AvdSimulatorSamples.endpoint
    override fun newAvdSimulatorSource(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher) =
        RefreshingAvdSimulatorCredentialSource(endpoint, exchange) { clock }
    override fun newTransport(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher): ConnectedSyncReceiverTransport =
        object : ConnectedSyncReceiverTransport by fake {
            override fun creationAuthorized() = credentialProvider().credential(endpoint) != null
            override fun create(taskId: String, callback: (SyncReply<CreatedSyncSession>) -> Unit): SyncCancellation {
                created++; return fake.create(taskId, callback)
            }
        }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MobileRequestFlowActivityTest {
    private class Host(val b: ActivityController<MobileFlowActivity>) {
        val a: MobileFlowActivity get() = b.get()
        val root: ViewGroup = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        private val bridge = ReflectionHelpers.getField<NativeInspectionBridge>(a, "bridge")
        fun tick(seconds: Long = 2) = shadowOf(Looper.getMainLooper()).idleFor(seconds, TimeUnit.SECONDS)
        fun rpc(op: String, extra: String = "") = bridge.handle("""{"op":"$op","localSessionId":"host","generation":1$extra}""")
        fun request(task: String = "tire.rear-right") { rpc("request", """, "taskId":"$task","partId":"$task""""); shadowOf(Looper.getMainLooper()).idle() }
        fun status() = root.findViewWithTag<TextView>("status").text.toString()
        fun qr() = root.findViewWithTag<ImageView>("qr").visibility
        fun inlineQr() = root.findViewWithTag<ImageView>("inline-qr")
        fun slot(kind: String, x: Int = 0, y: Int = 0, size: Int = 0) { rpc("panel", """, "slot":"$kind","x":$x,"y":$y,"size":$size"""); shadowOf(Looper.getMainLooper()).idle() }
        fun secure() = a.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
        fun receiver() = JsonParser.parseString(rpc("poll")).asJsonObject["receiver"]?.takeIf { it.isJsonObject }?.asJsonObject
    }
    private fun host() = Host(Robolectric.buildActivity(MobileFlowActivity::class.java).create().start()).also { it.rpc("open") }

    @Test fun `opening the 3D page asks for nothing and one request creates one session for its part after the grant`() {
        val h = host()
        h.tick(); assertEquals("a grant lasts two minutes, so opening the page must not spend one", 0, h.a.exchange.callbacks.size)
        h.request()
        assertEquals(1, h.a.exchange.callbacks.size); assertEquals(0, h.a.created)
        assertTrue(h.status(), h.status().contains("인증 대기")); assertEquals(View.GONE, h.qr())
        h.a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        assertEquals(1, h.a.created); assertEquals("tire.rear-right", h.a.fake.taskId)
        assertTrue(h.status(), h.status().contains("QR 생성 완료")); assertEquals(View.VISIBLE, h.qr())
        h.request(); h.tick()
        assertEquals("reopening creates nothing new", 1, h.a.created); assertEquals(1, h.a.exchange.callbacks.size)
        assertEquals("Accept stays a separate tap", 0, h.a.fake.accepted)
        h.b.stop().destroy()
    }

    @Test fun `the QR is drawn by Native over the page slot and never reaches the page`() {
        val h = host(); h.request()
        assertEquals("the default flow opens no management panel", View.GONE, h.root.getChildAt(1).visibility)
        assertEquals("AUTH_WAITING", h.receiver()!!["phase"].asString)
        h.a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        assertEquals("QR_READY", h.receiver()!!["phase"].asString)
        assertEquals("no slot yet, so nothing is drawn", View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.slot("SHOWN", 100, 200, 300)
        assertEquals(View.VISIBLE, h.inlineQr().visibility); assertNotNull(h.inlineQr().drawable); assertTrue(h.secure())
        val place = h.inlineQr().layoutParams as android.widget.FrameLayout.LayoutParams
        assertEquals(100, place.leftMargin); assertEquals(200, place.topMargin); assertEquals(300, place.width); assertEquals(300, place.height)
        for (reply in listOf(h.rpc("poll"), h.rpc("panel", """, "slot":"SHOWN","x":100,"y":200,"size":300"""))) {
            for (secret in listOf(HttpSamples.invite, HttpSamples.receiver, AvdSimulatorSamples.token, AvdSimulatorSamples.proof)) assertFalse(reply, reply.contains(secret))
        }
        h.slot("HIDDEN"); assertEquals("scrolled out of the panel", View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.slot("SHOWN", 100, 200, 40); assertEquals("too small to scan", View.GONE, h.inlineQr().visibility)
        h.slot("SHOWN", 100, 200, 300); assertEquals(View.VISIBLE, h.inlineQr().visibility)
        h.rpc("control", """, "action":"admin""""); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("the management panel has its own copy", View.GONE, h.inlineQr().visibility); assertTrue(h.secure())
        h.b.stop(); assertNull(h.inlineQr().drawable); assertEquals(View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.b.destroy()
    }

    @Test fun `the simulator confirms a verified result without a tap and labels it as automatic`() {
        val h = host(); val fake = h.a.fake
        val serverNow = System.currentTimeMillis(); val elapsed = System.nanoTime() / 1_000_000
        fake.serverClock = SyncServerClock.fromResponse(serverNow, elapsed, elapsed)
        fake.receivedAt = serverNow + 10_000; fake.acceptedAt = serverNow + 11_000
        h.request(); h.a.exchange.callbacks.last()(AvdSimulatorSamples.value()); h.rpc("poll")
        fake.claimed = true; h.tick(5); assertEquals("CONNECTED", h.receiver()!!["phase"].asString); assertEquals(0, fake.accepted)
        fake.result = true; h.tick(5)
        assertEquals(1, fake.accepted); assertEquals("COMPLETED", h.receiver()!!["phase"].asString)
        val delivered = JsonParser.parseString(h.rpc("poll")).asJsonObject["accepted"].asJsonArray
        assertEquals(1, delivered.size())
        val d = delivered[0].asJsonObject
        val verify = """, "bindingId":"${d["bindingId"].asString}","syncSessionId":"${d["syncSessionId"].asString}","taskId":"${d["taskId"].asString}","partId":"tire.rear-right","inspectionId":"${d["inspectionId"].asString}","resultDigest":"${d["resultDigest"].asString}""""
        val binding = bindingOf(h)
        val proof = JsonParser.parseString(h.rpc("verify", verify + """, "serverNow":${binding.first},"expiresAt":${binding.second}""")).asJsonObject["proof"].asJsonObject
        assertEquals("AVD_SIMULATION_AUTO", proof["confirmation"].asString)
        h.b.stop().destroy()
    }

    private fun bindingOf(h: Host): Pair<Long, Long> {
        val b = JsonParser.parseString(h.rpc("poll")).asJsonObject["bindings"].asJsonArray[0].asJsonObject
        return b["serverNow"].asLong to b["expiresAt"].asLong
    }

    @Test fun `a refused grant creates nothing and retries only at the throttled interval while the panel is open`() {
        val h = host(); h.request()
        h.a.exchange.callbacks.last()(null)
        assertEquals(0, h.a.created); assertEquals(View.GONE, h.qr()); assertTrue(h.status(), h.status().contains("인증 실패"))
        assertFalse(h.root.findViewWithTag<Button>("create").isEnabled)
        h.tick(5); assertEquals(1, h.a.exchange.callbacks.size)
        h.a.clock += 30_000; h.tick(); assertEquals(2, h.a.exchange.callbacks.size)
        h.a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        assertEquals(1, h.a.created)
        h.b.stop().destroy()
    }

    @Test fun `closing the panel while waiting creates no hidden session and reopening continues`() {
        val h = host(); h.request()
        h.slot("NONE") // The person moved to another part.
        h.a.exchange.callbacks.last()(AvdSimulatorSamples.value()); h.tick()
        assertEquals(0, h.a.created)
        h.request(); h.tick()
        assertEquals(1, h.a.created); assertEquals(View.VISIBLE, h.qr())
        h.b.stop().destroy()
    }

    @Test fun `a later request does not use an expired grant`() {
        val h = host(); h.request()
        h.a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        h.root.findViewWithTag<Button>("cancel").performClick()
        assertTrue(h.status(), h.status().contains("CANCELLED")); h.rpc("poll")
        h.a.clock = 122_000
        h.request()
        assertEquals("the old grant creates nothing", 1, h.a.created)
        assertEquals("a new grant is requested", 2, h.a.exchange.callbacks.size)
        h.b.stop().destroy()
    }

    @Test fun `stop drops a request waiting for its grant`() {
        val h = host(); h.request(); val late = h.a.exchange.callbacks.last()
        h.b.stop(); late(AvdSimulatorSamples.value())
        assertEquals(0, h.a.created)
        h.b.destroy()
    }
}
