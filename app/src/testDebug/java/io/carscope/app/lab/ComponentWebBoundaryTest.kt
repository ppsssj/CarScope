package io.carscope.app.lab

import android.app.Activity
import android.net.Uri
import android.webkit.WebResourceRequest
import com.google.gson.JsonParser
import io.carscope.app.component.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ComponentWebBoundaryTest {
    private val host = "carscope-inspection.invalid"
    private fun request(value: String, method: String = "GET") = object : WebResourceRequest {
        override fun getUrl() = Uri.parse(value)
        override fun isForMainFrame() = false
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = method
        override fun getRequestHeaders() = emptyMap<String, String>()
    }
    @Test fun `component cache endpoint is exact private GET only and does not broaden tire endpoint`() {
        assertTrue(DebugWebOrigin.componentStatusPath("https://$host/component-status.json", host, "GET"))
        for (value in listOf("http://$host/component-status.json", "https://evil.invalid/component-status.json", "https://$host:8443/component-status.json", "https://u@$host/component-status.json", "https://$host/component-status.json?x=1", "https://$host/component-status.json#x", "https://$host/%63omponent-status.json", "https://$host/tire-status.json")) assertFalse(value, DebugWebOrigin.componentStatusPath(value, host, "GET"))
        assertFalse(DebugWebOrigin.componentStatusPath("https://$host/component-status.json", host, "POST"))
        assertFalse(DebugWebOrigin.statusPath("https://$host/component-status.json", host, "GET"))
    }
    @Test fun `WebView interception reads only provided cache and keeps CSP file and content boundaries`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup()
        val worker = ComponentTestWorker(); val sdk = ComponentFakeSession()
        val source = PleosComponentDataSource({ sdk }, worker, { 1000 })
        val channel = ComponentUiChannel(ComponentOwner(source)); channel.start(); worker.drain()
        sdk.capabilities.values.toList().forEach { it.first(ComponentCapability(true, OIL_STATES)) }; worker.drain()
        for (f in ComponentFeature.entries) sdk.getters.getValue(f).first(when (f) { ComponentFeature.BRAKE -> ComponentValue.Oil("LOW"); ComponentFeature.SOC -> ComponentValue.Integer(73); else -> ComponentValue.Flag(false) })
        worker.drain()
        var reads = 0
        val screen = DebugWebScreen(activity.get(), "ComponentTest", host, "inspection", emptyMap(), componentStatusJson = { reads++; channel.readJson() })
        val web = screen.create("")
        try {
            val client = shadowOf(web).webViewClient!!
            val result = client.shouldInterceptRequest(web, request("https://$host/component-status.json"))!!
            assertEquals(200, result.statusCode); assertEquals("application/json", result.mimeType)
            val packet = JsonParser.parseString(result.data!!.bufferedReader().readText()).asJsonObject
            assertEquals(4, packet["readings"].asJsonArray.size())
            val washer = packet["readings"].asJsonArray[0].asJsonObject
            assertEquals(false, washer["value"].asBoolean); assertEquals(1000L, washer["observedAt"].asLong); assertEquals("PLEOS", washer["source"].asString)
            assertEquals("no-store", result.responseHeaders!!["Cache-Control"]); assertTrue(result.responseHeaders!!["Content-Security-Policy"]!!.contains("connect-src 'self'"))
            for (r in listOf(request("https://$host/component-status.json?x=1"), request("https://$host/component-status.json", "POST"), request("https://evil.invalid/component-status.json"), request("https://$host/tire-status.json"))) assertEquals(404, client.shouldInterceptRequest(web, r)!!.statusCode)
            assertEquals(1, reads); assertEquals(5, sdk.getters.size); assertFalse(web.settings.allowFileAccess); assertFalse(web.settings.allowContentAccess); assertFalse(web.settings.domStorageEnabled)
        } finally { screen.destroy(); channel.stop(); source.close(); worker.drain(); activity.pause().stop().destroy() }
    }
}
