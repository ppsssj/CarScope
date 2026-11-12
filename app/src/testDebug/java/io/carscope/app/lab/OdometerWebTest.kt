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

/** P14: the Odometer reaches the page only through its exact private cache route. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OdometerWebTest {
    private val host = "carscope-inspection.invalid"
    private fun request(url: String, method: String = "GET") = object : WebResourceRequest {
        override fun getUrl() = Uri.parse(url); override fun getMethod() = method
        override fun isForMainFrame() = false; override fun isRedirect() = false; override fun hasGesture() = false; override fun getRequestHeaders() = emptyMap<String, String>()
    }

    @Test fun `odometer endpoint is an exact private cache GET and opens no other channel`() {
        val worker = ComponentTestWorker(); val sdk = ComponentFakeSession(); val source = PleosComponentDataSource({ sdk }, worker, { 1000 })
        val channel = ComponentUiChannel(ComponentOwner(source)); channel.start(); worker.drain()
        sdk.capabilities.getValue(ComponentFeature.ODOMETER).first(ComponentCapability(true)); worker.drain()
        sdk.getters.getValue(ComponentFeature.ODOMETER).first(ComponentValue.Decimal(321.5f)); worker.drain()
        val activity = Robolectric.buildActivity(Activity::class.java).setup(); var reads = 0
        val screen = DebugWebScreen(activity.get(), "OdometerTest", host, "inspection", emptyMap(), odometerStatusJson = { reads++; channel.readOdometerJson() }); val web = screen.create("")
        try {
            val client = shadowOf(web).webViewClient!!
            val response = client.shouldInterceptRequest(web, request("https://$host/odometer-status.json"))!!
            assertEquals(200, response.statusCode); assertEquals("no-store", response.responseHeaders!!["Cache-Control"])
            val p = JsonParser.parseString(response.data!!.bufferedReader().readText()).asJsonObject
            val r = p["readings"].asJsonArray.single().asJsonObject
            assertEquals("odometer.distance-driven", r["featureId"].asString); assertEquals(321.5, r["value"].asDouble, 0.0); assertTrue(r["unit"].isJsonNull)
            for (path in listOf("odometer-status.json?x=1", "odometer-status.json#x", "%6Fdometer-status.json", "component-status.json", "visibility-status.json"))
                assertEquals(path, 404, client.shouldInterceptRequest(web, request("https://$host/$path"))!!.statusCode)
            assertEquals(404, client.shouldInterceptRequest(web, request("https://$host/odometer-status.json", "POST"))!!.statusCode)
            assertEquals(404, client.shouldInterceptRequest(web, request("https://evil.invalid/odometer-status.json"))!!.statusCode)
            assertEquals(1, reads); assertEquals(setOf(ComponentFeature.ODOMETER), sdk.getters.keys)
        } finally { screen.destroy(); channel.stop(); source.close(); worker.drain(); activity.pause().stop().destroy() }
        // A screen without the channel answers 404 rather than inventing a value.
        val other = Robolectric.buildActivity(Activity::class.java).setup()
        val bare = DebugWebScreen(other.get(), "OdometerOff", host, "inspection", emptyMap()); val view = bare.create("")
        try { assertEquals(404, shadowOf(view).webViewClient!!.shouldInterceptRequest(view, request("https://$host/odometer-status.json"))!!.statusCode) }
        finally { bare.destroy(); other.pause().stop().destroy() }
    }
}
