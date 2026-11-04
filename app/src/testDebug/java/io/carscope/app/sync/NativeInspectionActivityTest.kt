package io.carscope.app.sync

import android.os.Looper
import android.view.View
import android.view.ViewGroup
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
        val spinner = root.findViewWithTag<Spinner>("task")
        assertFalse(spinner.isEnabled)
        root.findViewWithTag<Button>("create").performClick()
        assertEquals("tire.rear-right", a.fake.taskId)
        assertNull(shadowOf(a).nextStartedActivity)
        a.onBackPressed()
        assertSame(web, root.getChildAt(0)); assertEquals(View.VISIBLE, web.visibility)
        assertFalse(a.isFinishing)
        rpc("request", """, "taskId":"tire.rear-right","partId":"tire.rear-right"""")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(View.VISIBLE, root.getChildAt(1).visibility)
        assertSame(web, root.getChildAt(0)); assertFalse(spinner.isEnabled)
        assertNull(shadowOf(a).nextStartedActivity)
        b.stop()
        assertTrue(a.fake.closed)
        assertTrue(rpc("poll").contains("UNAVAILABLE"))
        b.destroy()
    }
}
