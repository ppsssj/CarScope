package io.carscope.app.sync

import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import io.carscope.app.lab.InspectionActivity
import io.carscope.app.lab.receiverOverlayPlacement
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

/** Real Activity, WebView and controller with a synthetic transport. No server, QR scan or device is involved. */
class OverlayHostActivity : InspectionActivity() {
    internal val fake = ActivityFakeTransport()
    internal var clockNow = System.currentTimeMillis()
    override fun now() = clockNow
    override fun endpoint() = SyncEndpoint("https://localhost/", "https://mobile.example/")
    override fun newTransport(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher): ConnectedSyncReceiverTransport = fake
}
/** Same page, default credentials: only the endpoint exists, as on the DENY_DEFAULT AVD. */
class OverlayDenyActivity : InspectionActivity() {
    override fun endpoint() = SyncEndpoint("https://carscope-lluo.onrender.com", "https://carscope-lluo.onrender.com/")
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeOverlayActivityTest {
    private class Host(val b: ActivityController<OverlayHostActivity>) {
        val a: OverlayHostActivity get() = b.get()
        val root: ViewGroup = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        val web = root.getChildAt(0) as WebView
        val overlay = root.getChildAt(1) as FrameLayout
        private val bridge = ReflectionHelpers.getField<NativeInspectionBridge>(a, "bridge")
        fun idle() = shadowOf(Looper.getMainLooper()).idle()
        fun poll() = shadowOf(Looper.getMainLooper()).idleFor(5, TimeUnit.SECONDS)
        fun rpc(op: String, extra: String = "") = bridge.handle("""{"op":"$op","localSessionId":"host","generation":1$extra}""")
        fun open(task: String = "washer-fluid", part: String = "washer-fluid-cap") { rpc("open"); rpc("request", """, "taskId":"$task","partId":"$part""""); idle() }
        fun <T : View> tag(name: String): T = root.findViewWithTag(name)
        fun text(name: String) = tag<TextView>(name).text.toString()
        fun click(name: String) = tag<Button>(name).performClick()
        fun secure() = a.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
    }
    private fun host() = Host(Robolectric.buildActivity(OverlayHostActivity::class.java).create().start())

    @Test fun `panel opens over the same visible WebView and is secure only while open`() {
        val h = host(); assertFalse(h.secure()); assertEquals(View.GONE, h.overlay.visibility)
        h.open()
        assertEquals(View.VISIBLE, h.overlay.visibility); assertEquals(View.VISIBLE, h.web.visibility); assertTrue(h.web.isShown || h.web.visibility == View.VISIBLE)
        assertSame(h.web, h.root.getChildAt(0)); assertTrue(h.secure())
        assertTrue("panel draws above the page", h.root.indexOfChild(h.overlay) > h.root.indexOfChild(h.web))
        assertNull("no separate Activity", shadowOf(h.a).nextStartedActivity)
        h.click("close-panel")
        assertEquals(View.GONE, h.overlay.visibility); assertEquals(View.VISIBLE, h.web.visibility); assertSame(h.web, h.root.getChildAt(0)); assertFalse(h.secure())
        h.b.stop().destroy()
    }

    @Test fun `touches keys and accessibility never reach the 3D page while the panel is open`() {
        val h = host(); var touches = 0
        // Robolectric's WebView does not run real input, so a plain View directly under the overlay stands for the page.
        // The closed-panel assertions below prove this probe receives touches; the real WebView is an AVD check.
        val probe = View(h.a).apply { setOnTouchListener { _, _ -> touches++; true } }
        h.root.addView(probe, 1, FrameLayout.LayoutParams(-1, -1))
        assertSame(h.overlay, h.root.getChildAt(2))
        fun lay() { h.root.measure(View.MeasureSpec.makeMeasureSpec(1224, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(880, View.MeasureSpec.EXACTLY)); h.root.layout(0, 0, 1224, 880) }
        fun tap(x: Float, y: Float) {
            val t = SystemClock.uptimeMillis()
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) MotionEvent.obtain(t, t, action, x, y, 0).also { h.root.dispatchTouchEvent(it); it.recycle() }
        }
        val focusability = h.web.descendantFocusability
        lay(); tap(100f, 400f); assertEquals("reaches the page when closed", 2, touches)
        touches = 0; h.open(); lay()
        tap(100f, 400f); tap(1200f, 870f)
        assertEquals(0, touches)
        assertEquals("tapping outside does not close the panel", View.VISIBLE, h.overlay.visibility)
        assertFalse(h.web.isFocusable); assertFalse(h.web.isFocusableInTouchMode); assertEquals(ViewGroup.FOCUS_BLOCK_DESCENDANTS, h.web.descendantFocusability)
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS, h.web.importantForAccessibility)
        h.a.onBackPressed()
        assertEquals("Back closes only the panel", View.GONE, h.overlay.visibility); assertFalse(h.a.isFinishing)
        assertTrue(h.web.isFocusable); assertEquals(focusability, h.web.descendantFocusability); assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO, h.web.importantForAccessibility)
        lay(); tap(100f, 400f); assertEquals(2, touches)
        h.b.stop().destroy()
    }

    @Test fun `closing the panel keeps the server session while Cancel is a separate explicit action`() {
        val h = host(); h.open(); h.click("create")
        val image = h.tag<ImageView>("qr"); val shown = image.drawable; assertNotNull(shown)
        h.click("close-panel")
        assertEquals(0, h.a.fake.cancelled); assertFalse(h.a.fake.closed)
        assertTrue(h.text("status").startsWith("WAITING")); assertSame("same QR is kept for reopening", shown, image.drawable)
        assertTrue(h.text("close-note").contains("취소되지 않습니다"))
        h.open(); assertEquals(View.VISIBLE, h.overlay.visibility); assertSame("reopen creates nothing new", shown, image.drawable)
        h.click("cancel"); assertEquals(1, h.a.fake.cancelled); assertTrue(h.text("status").contains("CANCELLED"))
        assertEquals("cancel does not close the panel by itself", View.VISIBLE, h.overlay.visibility)
        h.b.stop().destroy()
    }

    @Test fun `QR shows connection and expiry states and is removed on claim and expiry`() {
        val h = host(); h.open()
        assertEquals(View.GONE, h.tag<ImageView>("qr").visibility); assertTrue(h.text("status").contains("'점검 요청 생성'"))
        h.click("create")
        assertEquals(View.VISIBLE, h.tag<ImageView>("qr").visibility); assertTrue(h.text("expiry").contains("QR 초대 만료")); assertTrue(h.text("status").contains("스마트폰 연결 전"))
        h.a.fake.claimed = true; h.poll()
        assertTrue(h.text("status"), h.text("status").contains("스마트폰 연결됨")); assertNull(h.tag<ImageView>("qr").drawable); assertEquals(View.GONE, h.tag<ImageView>("qr").visibility)
        h.b.stop().destroy()

        val e = host(); e.open(); e.click("create")
        e.a.clockNow = e.a.fake.expiry - 30000 + 1; e.poll()
        assertNull(e.tag<ImageView>("qr").drawable); assertTrue(e.text("status").contains("QR 초대 만료"))
        e.b.stop().destroy()
    }

    @Test fun `result needs explicit Accept and reaches the existing 3D bridge with no token`() {
        val h = host(); val fake = h.a.fake
        val serverNow = System.currentTimeMillis(); val elapsed = System.nanoTime() / 1_000_000
        fake.serverClock = SyncServerClock.fromResponse(serverNow, elapsed, elapsed)
        fake.receivedAt = serverNow + 10_000; fake.acceptedAt = serverNow + 11_000
        h.open(); h.click("create")
        val waiting = h.rpc("poll")
        assertTrue(waiting, waiting.contains("washer-fluid-cap")); assertFalse(waiting, waiting.contains(HttpSamples.invite)); assertFalse(waiting, waiting.contains(HttpSamples.receiver))
        fake.result = true; h.poll()
        assertTrue(h.text("status").contains("RESULT_SUBMITTED")); assertEquals("no automatic Accept", 0, fake.accepted)
        assertTrue(h.tag<Button>("accept").isEnabled); assertTrue(h.tag<Button>("cancel").isEnabled)
        assertFalse(h.rpc("poll"), h.rpc("poll").contains("\"proof\""))
        assertEquals(0, com.google.gson.JsonParser.parseString(h.rpc("poll")).asJsonObject["accepted"].asJsonArray.size())
        h.click("accept"); assertEquals(1, fake.accepted); assertTrue(h.text("status").contains("ACCEPTED"))
        val delivered = h.rpc("poll"); val accepted = com.google.gson.JsonParser.parseString(delivered).asJsonObject["accepted"].asJsonArray
        assertEquals(delivered, 1, accepted.size()); assertEquals("washer-fluid", accepted[0].asJsonObject["taskId"].asString)
        for (secret in listOf(HttpSamples.invite, HttpSamples.receiver)) assertFalse(delivered.contains(secret))
        h.click("close-panel"); assertEquals(View.VISIBLE, h.web.visibility)
        assertEquals("still deliverable after closing", 1, com.google.gson.JsonParser.parseString(h.rpc("poll")).asJsonObject["accepted"].asJsonArray.size())
        h.b.stop().destroy()
    }

    @Test fun `without creation authority the panel shows the state and no QR or enabled create`() {
        val b = Robolectric.buildActivity(OverlayDenyActivity::class.java).create().start(); val a = b.get()
        val root = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        val bridge = ReflectionHelpers.getField<NativeInspectionBridge>(a, "bridge")
        fun rpc(op: String, extra: String = "") = bridge.handle("""{"op":"$op","localSessionId":"host","generation":1$extra}""")
        rpc("open"); rpc("request", """, "taskId":"washer-fluid","partId":"washer-fluid-cap""""); shadowOf(Looper.getMainLooper()).idle()
        assertEquals(View.VISIBLE, root.getChildAt(1).visibility)
        assertFalse(root.findViewWithTag<Button>("create").isEnabled); assertEquals(View.GONE, root.findViewWithTag<ImageView>("qr").visibility)
        assertNull(root.findViewWithTag<ImageView>("qr").drawable)
        assertTrue(root.findViewWithTag<TextView>("status").text.contains("생성 권한 없음"))
        assertTrue(root.findViewWithTag<TextView>("authentication").text.contains("실제 차량 인증 미구현"))
        b.stop().destroy()
    }

    @Test fun `stop discards QR and authority hides the panel and rejects later requests`() {
        val h = host(); h.open(); h.click("create"); val image = h.tag<ImageView>("qr"); assertNotNull(image.drawable)
        h.b.stop()
        assertNull(image.drawable); assertTrue(h.a.fake.closed); assertEquals(0, h.a.fake.cancelled)
        assertEquals(View.GONE, h.overlay.visibility); assertFalse(h.secure()); assertTrue(h.rpc("poll").contains("UNAVAILABLE"))
        h.b.destroy()
    }

    @Test @Config(sdk = [28], qualifiers = "w1224dp-h880dp-land")
    fun `wide vehicle display uses a right side panel that leaves the vehicle visible`() {
        val h = host()
        val lp = h.tag<View>("receiver-panel").layoutParams as FrameLayout.LayoutParams
        assertEquals(Gravity.END, lp.gravity); assertEquals(FrameLayout.LayoutParams.MATCH_PARENT, lp.height)
        assertEquals(416, lp.width); assertEquals(0, lp.topMargin)
        h.b.stop().destroy()
    }

    @Test @Config(sdk = [28], qualifiers = "w420dp-h860dp-port")
    fun `narrow window uses a centered overlay below the page toast`() {
        val h = host()
        val lp = h.tag<View>("receiver-panel").layoutParams as FrameLayout.LayoutParams
        assertEquals(Gravity.CENTER_HORIZONTAL, lp.gravity and Gravity.HORIZONTAL_GRAVITY_MASK)
        assertEquals(388, lp.width); assertEquals(120, lp.topMargin); assertEquals(724, lp.height)
        h.b.stop().destroy()
    }

    @Test fun `placement keeps the panel inside the window and the 3D center uncovered when wide`() {
        for ((w, h) in listOf(320 to 480, 420 to 860, 839 to 600, 840 to 600, 1224 to 880, 1920 to 720, 2560 to 1440, 900 to 1200)) {
            val p = receiverOverlayPlacement(w, h)
            assertTrue("$w", p.widthDp in 1..w); assertTrue("$h", p.topDp + (p.heightDp ?: 0) <= h)
            if (p.side) assertTrue("side panel stays right of the window center", p.widthDp < w / 2) else assertTrue(p.topDp >= 120)
        }
        assertTrue(receiverOverlayPlacement(1224, 880).side); assertFalse(receiverOverlayPlacement(839, 600).side); assertFalse("portrait", receiverOverlayPlacement(900, 1200).side)
    }
}
