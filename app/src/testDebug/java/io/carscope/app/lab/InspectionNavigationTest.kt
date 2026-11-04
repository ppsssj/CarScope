package io.carscope.app.lab

import android.view.ViewGroup
import android.webkit.WebView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** No resume: tests the real Activity boundary without starting a Pleos lease or any SDK work. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class InspectionNavigationTest {
    private fun web(a: InspectionActivity): WebView {
        val root = a.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
        return root.getChildAt(0) as WebView
    }

    @Test fun `hardware Back sends fixed shared navigation and consumes handled response`() {
        val controller = Robolectric.buildActivity(InspectionActivity::class.java).create()
        val activity = controller.get(); val view = web(activity)
        activity.onBackPressed()
        val shadow = shadowOf(view)
        assertEquals("Boolean(window.__androidShell && window.__androidShell.back())", shadow.lastEvaluatedJavascript)
        shadow.lastEvaluatedJavascriptCallback.onReceiveValue("true")
        assertFalse(activity.isFinishing)
        assertTrue(view.settings.javaScriptEnabled)
        assertFalse(view.settings.allowFileAccess); assertFalse(view.settings.allowContentAccess)
        assertFalse(view.settings.domStorageEnabled)
        controller.destroy()
    }

    @Test fun `unready or missing page handler finishes rather than trapping native Back`() {
        for (response in listOf("false", "null")) {
            val controller = Robolectric.buildActivity(InspectionActivity::class.java).create()
            val activity = controller.get()
            activity.onBackPressed()
            shadowOf(web(activity)).lastEvaluatedJavascriptCallback.onReceiveValue(response)
            assertTrue(activity.isFinishing)
            controller.destroy()
        }
    }

    @Test fun `late navigation callback after finish cannot reopen or start another Activity`() {
        val controller = Robolectric.buildActivity(InspectionActivity::class.java).create()
        val activity = controller.get()
        activity.onBackPressed()
        val callback = shadowOf(web(activity)).lastEvaluatedJavascriptCallback
        activity.finish(); callback.onReceiveValue("false"); callback.onReceiveValue("true")
        assertTrue(activity.isFinishing); assertNull(shadowOf(activity).nextStartedActivity)
        controller.destroy()
    }

    @Test fun `late unhandled Back response cannot close a parent after pause`() {
        val controller = Robolectric.buildActivity(InspectionActivity::class.java).create()
        val activity = controller.get()
        activity.onBackPressed()
        val callback = shadowOf(web(activity)).lastEvaluatedJavascriptCallback
        controller.pause()
        callback.onReceiveValue("false")
        assertFalse(activity.isFinishing)
        controller.destroy()
    }
}
