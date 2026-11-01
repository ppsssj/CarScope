package io.carscope.app.sync

import android.app.Activity
import android.content.Intent
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import io.carscope.app.lab.InspectionActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

class EntryHostActivity : Activity() {
    private lateinit var entry: InspectionSyncEntry
    lateinit var content: TextView
    override fun onCreate(saved: android.os.Bundle?) {
        super.onCreate(saved)
        content = TextView(this).apply { text = "inspection content" }
        entry = InspectionSyncEntry(this); setContentView(entry.wrap(content))
    }
    override fun onResume() { super.onResume(); entry.resume() }
    override fun onPause() { entry.pause(); super.onPause() }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class InspectionSyncEntryTest {
    private fun button(a: Activity): Button = a.findViewById<ViewGroup>(android.R.id.content).findViewWithTag("inspection-sync-entry")
    @Test fun `actual inspection hosts a native entry beside its unchanged WebView`() {
        // No resume: this integration/layout test deliberately does not start the Pleos SDK lease.
        val b = Robolectric.buildActivity(InspectionActivity::class.java).create(); val a = b.get()
        val root = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        assertEquals(2, root.childCount); assertSame(button(a), root.getChildAt(0))
        assertTrue(root.getChildAt(1) is android.webkit.WebView)
        assertTrue(button(a).text.contains("워셔액")); assertFalse(button(a).text.contains("타이어"))
        b.destroy()
    }
    @Test fun `entry sends one explicit credential-free Intent and Back leaves parent content intact`() {
        val parent = Robolectric.buildActivity(EntryHostActivity::class.java).setup(); val a = parent.get()
        button(a).performClick(); button(a).performClick()
        val launch = shadowOf(a).nextStartedActivity
        assertEquals(SyncReceiverActivity::class.java.name, launch.component!!.className)
        assertNull(launch.extras); assertNull(launch.data); assertNull(launch.action)
        assertEquals(Intent.FLAG_ACTIVITY_SINGLE_TOP, launch.flags); assertNull(shadowOf(a).nextStartedActivity)
        parent.pause().stop()
        val receiver = Robolectric.buildActivity(SyncReceiverActivity::class.java, launch).setup()
        receiver.get().onBackPressed(); shadowOf(Looper.getMainLooper()).idle()
        assertTrue(receiver.get().isFinishing); receiver.pause().stop().destroy()
        parent.start().resume().visible()
        assertFalse(a.isFinishing); assertTrue(button(a).isEnabled); assertEquals("inspection content", a.content.text.toString())
        button(a).performClick(); assertNotNull(shadowOf(a).nextStartedActivity)
        parent.pause().stop().destroy()
    }
    @Test fun `pause disables entry and resume re-enables it without a new launch`() {
        val b = Robolectric.buildActivity(EntryHostActivity::class.java).setup(); val a = b.get()
        b.pause(); assertFalse(button(a).isEnabled); assertNull(shadowOf(a).nextStartedActivity)
        b.resume(); assertTrue(button(a).isEnabled); assertNull(shadowOf(a).nextStartedActivity)
        b.pause().stop().destroy()
    }
}
