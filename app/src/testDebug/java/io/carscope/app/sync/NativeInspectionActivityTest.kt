package io.carscope.app.sync

import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Button
import android.widget.Spinner
import io.carscope.app.lab.InspectionActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

class BridgeHostFixtureActivity : InspectionActivity() {
    internal val fake = ActivityFakeTransport()
    override fun endpoint() = SyncEndpoint("https://localhost/", "https://mobile.example/")
    override fun newTransport(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher): ConnectedSyncReceiverTransport = fake
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeInspectionActivityTest {
    @Test fun `request and Back use same Activity WebView then stop closes authority and rejects callback`() {
        // start without resume: exercise real receiver/WebView ownership without acquiring a Pleos SDK lease.
        val b = Robolectric.buildActivity(BridgeHostFixtureActivity::class.java).create().start()
        val a = b.get()
        val root = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        val web = root.getChildAt(0) as WebView
        val bridge = ReflectionHelpers.getField<NativeInspectionBridge>(a, "bridge")
        fun rpc(op: String, extra: String = "") = bridge.handle("""{"op":"$op","localSessionId":"host","generation":1$extra}""")
        assertTrue(rpc("open").contains("true"))
        rpc("request", """, "taskId":"tire.rear-right","partId":"tire.rear-right"""")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("the default flow opens no management panel", View.GONE, root.getChildAt(1).visibility)
        val spinner = root.findViewWithTag<Spinner>("task")
        assertFalse(spinner.isEnabled)
        root.findViewWithTag<Button>("create").performClick()
        assertEquals("tire.rear-right", a.fake.taskId)
        assertNull(shadowOf(a).nextStartedActivity)
        a.onBackPressed()
        assertSame(web, root.getChildAt(0)); assertEquals(View.VISIBLE, web.visibility)
        assertFalse(a.isFinishing)
        rpc("control", """, "action":"admin"""")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(View.VISIBLE, root.getChildAt(1).visibility)
        assertSame(web, root.getChildAt(0)); assertFalse(spinner.isEnabled)
        assertNull(shadowOf(a).nextStartedActivity)
        b.stop()
        assertTrue(a.fake.closed)
        assertTrue(rpc("poll").contains("UNAVAILABLE"))
        b.destroy()
    }
    @Test fun `only the Native panel is secure and pause revokes bridge and returns to the 3D page`() {
        val b = Robolectric.buildActivity(BridgeHostFixtureActivity::class.java).create().start()
        val a = b.get()
        val root = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        val web = root.getChildAt(0) as WebView; val panel = root.getChildAt(1)
        val bridge = ReflectionHelpers.getField<NativeInspectionBridge>(a, "bridge")
        fun secure() = a.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
        fun rpc(op: String, extra: String = "") = bridge.handle("""{"op":"$op","localSessionId":"host","generation":1$extra}""")
        val request = """, "taskId":"battery-12v","partId":"battery-12v""""
        assertFalse(secure())
        rpc("open"); shadowOf(Looper.getMainLooper()).idle()
        rpc("request", request); rpc("control", """, "action":"admin""""); shadowOf(Looper.getMainLooper()).idle()
        assertTrue(secure()); assertEquals(View.VISIBLE, panel.visibility); assertEquals(View.VISIBLE, web.visibility)
        root.findViewWithTag<Button>("close-panel").performClick()
        assertFalse(secure()); assertEquals(View.GONE, panel.visibility); assertEquals(View.VISIBLE, web.visibility)
        rpc("control", """, "action":"admin""""); shadowOf(Looper.getMainLooper()).idle()
        assertTrue(secure())
        b.pause(); shadowOf(Looper.getMainLooper()).idle() // pause without stop: dialog or multi-window focus loss
        assertTrue(rpc("poll").contains("UNAVAILABLE"))
        assertFalse(secure()); assertEquals(View.GONE, panel.visibility); assertEquals(View.VISIBLE, web.visibility)
        b.stop().destroy()
    }
    @Test fun `without the simulator a received result waits for the explicit Accept and the page is told so`() {
        val b = Robolectric.buildActivity(BridgeHostFixtureActivity::class.java).create().start()
        val a = b.get()
        val root = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        val bridge = ReflectionHelpers.getField<NativeInspectionBridge>(a, "bridge")
        fun rpc(op: String, extra: String = "") = bridge.handle("""{"op":"$op","localSessionId":"host","generation":1$extra}""")
        val serverNow = System.currentTimeMillis(); val elapsed = System.nanoTime() / 1_000_000
        a.fake.serverClock = SyncServerClock.fromResponse(serverNow, elapsed, elapsed)
        rpc("open"); rpc("request", """, "taskId":"washer-fluid","partId":"washer-fluid-cap""""); shadowOf(Looper.getMainLooper()).idle()
        assertTrue("the granted request creates its session", rpc("poll").contains("QR_READY"))
        a.fake.result = true; shadowOf(Looper.getMainLooper()).idleFor(3, java.util.concurrent.TimeUnit.SECONDS)
        val poll = rpc("poll")
        assertTrue(poll, poll.contains("\"phase\":\"AWAITING_CONFIRMATION\""))
        assertFalse("an OEM path is never confirmed automatically", poll.contains("RESULT_RECEIVED") || poll.contains("COMPLETED"))
        assertEquals(0, a.fake.accepted)
        assertTrue(root.findViewWithTag<Button>("accept").isEnabled)
        val status = root.findViewWithTag<android.widget.TextView>("native-3d-status").text.toString()
        assertTrue(status, status.contains("수락하면 3D에 반영"))
        b.stop().destroy()
    }
}
