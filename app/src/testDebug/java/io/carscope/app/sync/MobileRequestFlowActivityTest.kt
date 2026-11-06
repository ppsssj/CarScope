package io.carscope.app.sync

import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
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
        h.root.findViewWithTag<Button>("close-panel").performClick()
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
