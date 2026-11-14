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
    // Robolectric's WebView never takes a frame, so the bounds a real layout pass gives are set here (empty: not laid out).
    internal var webFrame = android.graphics.Rect()
    override fun inlineQrHost() = webFrame
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
        // A page slot in CSS px of a viewport the size of the recorded AVD page (1224×880).
        fun slot(kind: String, x: Int = 0, y: Int = 0, size: Int = 0, vw: Int = if (kind == "SHOWN") 1224 else 0, vh: Int = if (kind == "SHOWN") 880 else 0) {
            rpc("panel", """, "slot":"$kind","x":$x,"y":$y,"size":$size,"vw":$vw,"vh":$vh"""); shadowOf(Looper.getMainLooper()).idle()
        }
        /** The WebView laid out at [w]×[h] px, as on the AVD (1682×1210 at density 1.0), then the Activity's layout hook. */
        fun layoutWeb(w: Int = 1682, h: Int = 1210) { a.webFrame = android.graphics.Rect(0, 0, w, h); a.onInlineQrHostLaidOut(); shadowOf(Looper.getMainLooper()).idle() }
        fun placed() = (inlineQr().layoutParams as android.widget.FrameLayout.LayoutParams).let { listOf(it.leftMargin, it.topMargin, it.width, it.height) }
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
        h.slot("SHOWN", 870, 300, 300)
        assertEquals("the WebView is not laid out yet, so no scale is known", View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.layoutWeb()
        assertEquals("the layout pass places it without a new report", View.VISIBLE, h.inlineQr().visibility)
        assertNotNull(h.inlineQr().drawable); assertTrue(h.secure())
        // Slot (870, 300, 300) CSS px × 1682/1224 = the slot in WebView pixels. Density 1.0 alone gave (870, 300, 300).
        assertEquals(listOf(1196, 412, 412, 412), h.placed())
        for (reply in listOf(h.rpc("poll"), h.rpc("panel", """, "slot":"SHOWN","x":870,"y":300,"size":300,"vw":1224,"vh":880"""))) {
            for (secret in listOf(HttpSamples.invite, HttpSamples.receiver, AvdSimulatorSamples.token, AvdSimulatorSamples.proof)) assertFalse(reply, reply.contains(secret))
        }
        h.slot("SHOWN", 870, 180, 300); assertEquals("the panel scrolled: the QR follows", listOf(1196, 247, 412, 412), h.placed())
        h.slot("HIDDEN"); assertEquals("scrolled out of the panel", View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.slot("SHOWN", 870, 300, 60); assertEquals("too small to scan", View.GONE, h.inlineQr().visibility)
        h.slot("SHOWN", 870, 300, 300); assertEquals(View.VISIBLE, h.inlineQr().visibility)
        h.layoutWeb(1682, 900)
        assertEquals("the WebView changed size: the old report is not drawn", View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.slot("SHOWN", 870, 200, 300, 1224, 655); assertEquals(listOf(1196, 275, 412, 412), h.placed()); assertTrue(h.secure())
        h.layoutWeb(); h.slot("SHOWN", 870, 300, 300); assertEquals(listOf(1196, 412, 412, 412), h.placed())
        h.rpc("control", """, "action":"admin""""); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("the management panel has its own copy", View.GONE, h.inlineQr().visibility); assertTrue(h.secure())
        h.b.stop(); assertNull(h.inlineQr().drawable); assertEquals(View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.b.destroy()
    }

    @Test fun `cancel and invite expiry release the inline QR bitmap and the secure window`() {
        val h = host(); h.request(); h.a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        h.layoutWeb(); h.slot("SHOWN", 870, 300, 300)
        assertEquals(View.VISIBLE, h.inlineQr().visibility); assertTrue(h.secure())
        h.rpc("control", """, "action":"cancel""""); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("CANCELLED", h.receiver()!!["phase"].asString)
        assertNull(h.inlineQr().drawable); assertEquals(View.GONE, h.inlineQr().visibility); assertFalse(h.secure())
        h.slot("SHOWN", 870, 300, 300); assertEquals("a stale slot report draws nothing after cancel", View.GONE, h.inlineQr().visibility)
        h.b.stop().destroy()

        val e = host(); e.request(); e.a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        e.layoutWeb(); e.slot("SHOWN", 870, 300, 300); assertEquals(View.VISIBLE, e.inlineQr().visibility)
        e.a.clock = e.a.fake.expiry - 29_000; e.tick() // the invite (expiry - 30 s) has passed; the session has not
        assertEquals("QR_EXPIRED", e.receiver()!!["phase"].asString)
        assertNull(e.inlineQr().drawable); assertEquals(View.GONE, e.inlineQr().visibility); assertFalse(e.secure())
        e.b.stop().destroy()
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
        assertTrue(h.status(), h.status().contains("자동 수신 확인")); assertTrue(h.status(), h.status().contains("차량 소유자 승인·안전 판정 아님"))
        assertFalse("not worded as a person accepting", h.status().contains("수락 완료"))
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

    // P22: a 401 repeated every 30 s while the panel was open (2026-11-14 AVD log). The same proof gets the same
    // answer, so a refusal is not retried by itself; only a new request (or the service check) asks again.
    @Test fun `a refused grant (401) creates nothing and is not retried until the person asks again`() {
        val h = host(); h.request()
        h.a.exchange.failure = ProvisionFailure.UNAUTHORIZED
        h.a.exchange.callbacks.last()(null)
        assertEquals(0, h.a.created); assertEquals(View.GONE, h.qr()); assertTrue(h.status(), h.status().contains("AVD 등록 거부"))
        assertFalse(h.root.findViewWithTag<Button>("create").isEnabled)
        assertEquals("AUTH_FAILED", h.receiver()!!["phase"].asString)
        repeat(10) { h.a.clock += 60_000; h.tick() }
        assertEquals("ten minutes later still one request", 1, h.a.exchange.callbacks.size)
        assertTrue("the page offers its own retry", h.receiver()!!["retryAvailable"].asBoolean)
        h.a.clock = 2100 // the fixed sample grant is valid only at its own issue time
        h.rpc("control", """, "action":"refresh""""); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("the person's 다시 확인 asks again, once", 2, h.a.exchange.callbacks.size)
        h.a.exchange.failure = null
        h.a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        assertEquals(1, h.a.created)
        h.b.stop().destroy()
    }

    @Test fun `a starting service is retried at 30, 60 and 120 seconds, shown as waiting, then stops`() {
        val h = host(); h.request()
        h.a.exchange.failure = ProvisionFailure.SERVER_UNAVAILABLE
        h.a.exchange.callbacks.last()(null)
        assertEquals("waiting, not a refusal", "AUTH_WAITING", h.receiver()!!["phase"].asString)
        assertTrue(h.status(), h.status().contains("서버 준비 중"))
        for ((gap, expected) in listOf(29_000L to 1, 1_000L to 2)) { h.a.clock += gap; h.tick(); assertEquals(expected, h.a.exchange.callbacks.size) }
        h.a.exchange.callbacks.last()(null)
        h.a.clock += 59_000; h.tick(); assertEquals(2, h.a.exchange.callbacks.size)
        h.a.clock += 1_000; h.tick(); assertEquals(3, h.a.exchange.callbacks.size)
        h.a.exchange.callbacks.last()(null)
        h.a.clock += 120_000; h.tick(); assertEquals(4, h.a.exchange.callbacks.size)
        h.a.exchange.callbacks.last()(null)
        repeat(10) { h.a.clock += 60_000; h.tick() }
        assertEquals("three automatic retries, then none", 4, h.a.exchange.callbacks.size)
        assertEquals("AUTH_FAILED", h.receiver()!!["phase"].asString)
        assertTrue(h.status(), h.status().contains("자동 재시도를 멈췄습니다"))
        assertEquals(0, h.a.created)
        h.b.stop().destroy()
    }

    @Test fun `a rate limited grant waits two minutes once and never loops`() {
        val h = host(); h.request()
        h.a.exchange.failure = ProvisionFailure.RATE_LIMITED
        h.a.exchange.callbacks.last()(null)
        h.a.clock += 119_000; h.tick(); assertEquals(1, h.a.exchange.callbacks.size)
        h.a.clock += 1_000; h.tick(); assertEquals(2, h.a.exchange.callbacks.size)
        h.a.exchange.callbacks.last()(null)
        repeat(10) { h.a.clock += 60_000; h.tick() }
        assertEquals(2, h.a.exchange.callbacks.size)
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
