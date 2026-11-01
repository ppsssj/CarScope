package io.carscope.app.sync

import android.graphics.drawable.BitmapDrawable
import android.os.Bundle
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.Shadows.shadowOf
import java.util.concurrent.TimeUnit

internal class ActivityFakeTransport : ConnectedSyncReceiverTransport {
    val expiry = System.currentTimeMillis() + 60000
    var accepted = 0; var cancelled = 0; var closed = false; var defer = false
    var late: (() -> Unit)? = null
    var cancelFailure = false
    var result = false
    override fun creationAuthorized() = !closed
    override fun checkConnection(callback: (SyncReply<Unit>) -> Unit): SyncCancellation { callback(SyncReply.Success(Unit)); return SyncCancellation {} }
    override fun create(callback: (SyncReply<CreatedSyncSession>) -> Unit): SyncCancellation {
        val reply = { callback(SyncReply.Success(CreatedSyncSession(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), InviteCredential(HttpSamples.invite), expiry - 30000, expiry))) }
        if (defer) late = reply else reply()
        return SyncCancellation {}
    }
    override fun view(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
        callback(SyncReply.Success(SyncReceiverView(id, if (result) SyncSessionState.RESULT_SUBMITTED else SyncSessionState.CREATED, expiry,
            if (result) HttpSamples.result else null, if (result) HttpSamples.result.digest() else null)))
        return SyncCancellation {}
    }
    override fun accept(id: String, receiver: ReceiverCredential, digest: String, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
        accepted++
        val reply = { callback(SyncReply.Success(SyncReceiverView(id, SyncSessionState.ACCEPTED, expiry, HttpSamples.result, digest))) }
        if (defer) late = reply else reply()
        return SyncCancellation {}
    }
    override fun cancel(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
        cancelled++
        callback(if (cancelFailure) SyncReply.Failure(SyncFailure.NETWORK) else SyncReply.Success(SyncReceiverView(id, SyncSessionState.CANCELLED, expiry)))
        return SyncCancellation {}
    }
    override fun close() { closed = true }
}

class ReceiverFixtureActivity : SyncReceiverActivity() {
    internal val fake = ActivityFakeTransport()
    internal var clock = System.currentTimeMillis()
    override fun now() = clock
    override fun endpoint() = SyncEndpoint("https://localhost/", "https://mobile.example/")
    override fun newTransport(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher): ConnectedSyncReceiverTransport = fake
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SyncReceiverActivityTest {
    private fun <T : View> view(activity: SyncReceiverActivity, tag: String): T = activity.findViewById<ViewGroup>(android.R.id.content).findViewWithTag(tag)
    private fun text(activity: SyncReceiverActivity, tag: String): String = view<TextView>(activity, tag).text.toString()
    private fun poll() { shadowOf(Looper.getMainLooper()).idleFor(2, TimeUnit.SECONDS) }
    @Test fun `default Activity never offers creation without configured credentials`() {
        val builder = Robolectric.buildActivity(SyncReceiverActivity::class.java).setup(); val activity = builder.get()
        assertFalse(view<Button>(activity, "create").isEnabled)
        assertFalse(view<Button>(activity, "accept").isEnabled)
        assertTrue(text(activity, "connection").contains("설정 미완료"))
        assertEquals(WindowManager.LayoutParams.FLAG_SECURE, activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE)
        builder.pause().stop().destroy()
    }
    @Test fun `configured HTTPS addresses do not enable production creation and intents cannot provide credential`() {
        val builder = Robolectric.buildActivity(SyncReceiverActivity::class.java).create(); val activity = builder.get()
        val file = java.io.File(activity.filesDir, "sync-endpoint.json")
        try {
            file.writeText("""{"apiOrigin":"https://api.example/","mobileRoot":"https://mobile.example/"}""")
            activity.intent.putExtra("testAuth", true).putExtra("credential", HttpSamples.receiver)
            builder.start().resume().visible()
            assertFalse(view<Button>(activity, "create").isEnabled); assertTrue(view<Button>(activity, "probe").isEnabled)
            assertTrue(text(activity, "authentication").contains("실제 차량 인증 미구현"))
        } finally { builder.pause().stop().destroy(); file.delete() }
    }
    @Test fun `QR bitmap round trips to exact v2 invite without receiver token and is not saved`() {
        val builder = Robolectric.buildActivity(ReceiverFixtureActivity::class.java).setup(); val activity = builder.get()
        view<Button>(activity, "create").performClick()
        val image = view<ImageView>(activity, "qr"); assertEquals(View.VISIBLE, image.visibility); assertFalse(image.isSaveEnabled)
        val bitmap = (image.drawable as BitmapDrawable).bitmap
        val pixels = IntArray(bitmap.width * bitmap.height); bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val decoded = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bitmap.width, bitmap.height, pixels)))).text
        assertEquals("https://mobile.example/#v=2&task=washer-fluid&invite=" + HttpSamples.invite, decoded)
        assertFalse(decoded.contains(HttpSamples.receiver)); assertTrue(text(activity, "expiry").contains("QR 초대 만료"))
        assertFalse(view<Button>(activity, "accept").isEnabled)
        builder.pause().stop(); assertNull(image.drawable); assertTrue(activity.fake.closed); assertEquals(0, activity.fake.cancelled)
        builder.destroy()
    }
    @Test fun `received result needs explicit accept and duplicates are disabled`() {
        val builder = Robolectric.buildActivity(ReceiverFixtureActivity::class.java).setup(); val activity = builder.get()
        view<Button>(activity, "create").performClick(); activity.fake.result = true; poll()
        assertTrue(text(activity, "status").contains("RESULT_SUBMITTED")); assertTrue(text(activity, "result").contains("센서 진단이 아닙니다"))
        assertEquals(0, activity.fake.accepted); activity.fake.defer = true
        view<Button>(activity, "accept").performClick(); view<Button>(activity, "accept").performClick(); view<Button>(activity, "cancel").performClick()
        assertEquals(1, activity.fake.accepted); assertEquals(0, activity.fake.cancelled)
        activity.fake.late!!(); assertTrue(text(activity, "status").contains("ACCEPTED")); assertFalse(view<Button>(activity, "accept").isEnabled)
        builder.pause().stop().destroy()
    }
    @Test fun `cancel failure never displays CANCELLED and explicit success does`() {
        val builder = Robolectric.buildActivity(ReceiverFixtureActivity::class.java).setup(); val activity = builder.get()
        view<Button>(activity, "create").performClick(); activity.fake.cancelFailure = true
        view<Button>(activity, "cancel").performClick(); assertFalse(text(activity, "status").contains("CANCELLED")); assertTrue(text(activity, "status").contains("NETWORK"))
        activity.fake.cancelFailure = false; view<Button>(activity, "cancel").performClick(); assertTrue(text(activity, "status").contains("CANCELLED"))
        builder.pause().stop().destroy()
    }
    @Test fun `stopped recreated Activity discards QR credentials and ignores previous callback`() {
        val old = Robolectric.buildActivity(ReceiverFixtureActivity::class.java).setup(); old.get().fake.defer = true
        view<Button>(old.get(), "create").performClick(); val delayed = old.get().fake.late!!
        val saved = Bundle(); old.saveInstanceState(saved).pause().stop().destroy()
        val fresh = Robolectric.buildActivity(ReceiverFixtureActivity::class.java).create(saved).start().resume().visible()
        delayed(); assertNull(view<ImageView>(fresh.get(), "qr").drawable); assertEquals("IDLE", text(fresh.get(), "status"))
        assertTrue(view<Button>(fresh.get(), "create").isEnabled); assertFalse(view<Button>(fresh.get(), "accept").isEnabled)
        fresh.pause().stop().destroy()
    }
    @Test fun `invite expiry removes QR before it can be scanned again`() {
        val builder = Robolectric.buildActivity(ReceiverFixtureActivity::class.java).setup(); val activity = builder.get()
        view<Button>(activity, "create").performClick()
        activity.clock = activity.fake.expiry - 30000 + 1
        shadowOf(Looper.getMainLooper()).idleFor(1, TimeUnit.SECONDS)
        assertNull(view<ImageView>(activity, "qr").drawable)
        activity.clock = activity.fake.expiry + 1; poll()
        assertTrue(text(activity, "status").contains("EXPIRED")); assertFalse(view<Button>(activity, "accept").isEnabled)
        builder.pause().stop().destroy()
    }
}
