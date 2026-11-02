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
class ChargePortWebTest {
    private val host = "carscope-inspection.invalid"
    private fun request(value: String, method: String = "GET") = object : WebResourceRequest {
        override fun getUrl() = Uri.parse(value)
        override fun isForMainFrame() = false
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = method
        override fun getRequestHeaders() = emptyMap<String, String>()
    }
    @Test fun `charge cache GET is exact isolated and sanitized without SDK calls`() {
        val worker = ComponentTestWorker(); val sdk = ComponentFakeSession()
        val source = PleosComponentDataSource({ sdk }, worker, { 1000 })
        val channel = ComponentUiChannel(ComponentOwner(source)); channel.start(); worker.drain()
        sdk.capabilities.getValue(ComponentFeature.CHARGE_PORT).first(ComponentCapability(true)); worker.drain()
        sdk.getters.getValue(ComponentFeature.CHARGE_PORT).first(ComponentValue.Flag(false)); worker.drain()
        val activity = Robolectric.buildActivity(Activity::class.java).setup(); var reads = 0
        val screen = DebugWebScreen(activity.get(), "ChargeTest", host, "inspection", emptyMap(), chargePortStatusJson = { reads++; channel.readChargePortJson() })
        val web = screen.create("")
        try {
            val client = shadowOf(web).webViewClient!!
            val response = client.shouldInterceptRequest(web, request("https://$host/ev-charge-status.json"))!!
            assertEquals(200, response.statusCode); assertEquals("no-store", response.responseHeaders!!["Cache-Control"])
            val row = JsonParser.parseString(response.data!!.bufferedReader().readText()).asJsonObject["readings"].asJsonArray[0].asJsonObject
            assertFalse(row["value"].asBoolean); assertEquals(1000L, row["observedAt"].asLong)
            for (bad in listOf("http://$host/ev-charge-status.json", "https://$host/ev-charge-status.json?x=1", "https://$host/ev-charge-status.json#x", "https://$host/%65v-charge-status.json", "https://$host:444/ev-charge-status.json", "https://user@$host/ev-charge-status.json", "https://evil.invalid/ev-charge-status.json", "https://$host/component-status.json", "https://$host/tire-status.json")) assertEquals(bad, 404, client.shouldInterceptRequest(web, request(bad))!!.statusCode)
            assertEquals(404, client.shouldInterceptRequest(web, request("https://$host/ev-charge-status.json", "POST"))!!.statusCode)
            assertEquals(1, reads); assertEquals(1, sdk.getters.size)
            assertFalse(web.settings.allowFileAccess); assertFalse(web.settings.allowContentAccess); assertFalse(web.settings.domStorageEnabled)
        } finally { screen.destroy(); channel.stop(); source.close(); worker.drain(); activity.pause().stop().destroy() }
    }
    @Test fun `InspectionActivity stop resume and recreation rotate shared charge lease without a new SDK client`() {
        val field = ComponentProcessOwner::class.java.getDeclaredField("owner").apply { isAccessible = true }
        val previous = field.get(null); val worker = ComponentTestWorker(); val sdk = ComponentFakeSession()
        val source = PleosComponentDataSource({ sdk }, worker, { 1000 }); field.set(null, ComponentOwner(source))
        fun channel(a: InspectionActivity) = InspectionActivity::class.java.getDeclaredField("componentStatus").apply { isAccessible = true }.get(a) as ComponentUiChannel
        val first = Robolectric.buildActivity(InspectionActivity::class.java)
        try {
            first.create().start().resume(); worker.drain()
            val old = JsonParser.parseString(channel(first.get()).readChargePortJson()).asJsonObject
            first.pause().stop(); worker.drain()
            assertEquals("STOPPED", JsonParser.parseString(channel(first.get()).readChargePortJson()).asJsonObject["connectionStatus"].asString)
            first.restart().start().resume(); worker.drain()
            val resumed = JsonParser.parseString(channel(first.get()).readChargePortJson()).asJsonObject
            assertNotEquals(old["sessionId"], resumed["sessionId"])
            first.pause().stop().destroy(); worker.drain()
            val second = Robolectric.buildActivity(InspectionActivity::class.java).create().start().resume()
            try {
                worker.drain(); val recreated = JsonParser.parseString(channel(second.get()).readChargePortJson()).asJsonObject
                assertNotEquals(resumed["sessionId"], recreated["sessionId"]); assertEquals(1, sdk.initialized)
                assertEquals("ATTACHED", recreated["connectionStatus"].asString)
            } finally { second.pause().stop().destroy(); worker.drain() }
        } finally { field.set(null, previous); source.close(); worker.drain() }
    }
}
