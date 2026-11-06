package io.carscope.app.lab

import android.app.Activity
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Exercises the real DebugWebScreen interception. Robolectric cannot prove Chromium supplies Referer; that stays device evidence. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeInspectionWebChannelTest {
    private val host = "carscope-inspection.invalid"
    private val page = "https://$host/index.html?capture=1"
    private val rpc = "https://$host/native-inspection-v1?command=%7B%22op%22%3A%22poll%22%7D"
    private fun request(value: String, referer: String? = page, mainFrame: Boolean = false, method: String = "GET") = object : WebResourceRequest {
        override fun getUrl() = Uri.parse(value)
        override fun isForMainFrame() = mainFrame
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = method
        override fun getRequestHeaders() = if (referer == null) emptyMap() else mapOf("Referer" to referer)
    }
    @Test fun `the history channel is separate, off unless composed, and limited to the current asset page`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup()
        val rpcHistory = "https://$host/native-history-v1?command=%7B%22op%22%3A%22list%22%7D"
        val reads = mutableListOf<String>(); val bridge = mutableListOf<String>()
        val screen = DebugWebScreen(activity.get(), "HistoryTest", host, "inspection", emptyMap(),
            inspectionBridge = { bridge += it; """{"ok":true}""" }, historyChannel = { reads += it; """{"status":200,"body":{}}""" })
        val web = screen.create("capture=1")
        val closed = DebugWebScreen(activity.get(), "HistoryOffTest", host, "inspection", emptyMap())
        val webClosed = closed.create("capture=1")
        try {
            val client = shadowOf(web).webViewClient!!
            client.onPageStarted(web, page, null)
            val reply = client.shouldInterceptRequest(web, request(rpcHistory))!!
            assertEquals(200, reply.statusCode); assertEquals("no-store", reply.responseHeaders!!["Cache-Control"])
            assertEquals("""{"status":200,"body":{}}""", reply.data!!.bufferedReader().readText())
            assertEquals(listOf("""{"op":"list"}"""), reads)
            assertTrue("history reads never reach the inspection bridge", bridge.isEmpty())
            for ((name, denied) in listOf("no referer" to request(rpcHistory, referer = null), "main frame" to request(rpcHistory, mainFrame = true),
                "post" to request(rpcHistory, method = "POST"), "extra parameter" to request("$rpcHistory&x=1"),
                "remote host" to request(rpcHistory.replace(host, "evil.invalid")), "no command" to request("https://$host/native-history-v1")))
                assertEquals(name, 404, client.shouldInterceptRequest(web, denied)!!.statusCode)
            assertEquals("a different WebView", 404, client.shouldInterceptRequest(WebView(activity.get()), request(rpcHistory))!!.statusCode)
            val off = shadowOf(webClosed).webViewClient!!
            off.onPageStarted(webClosed, page, null)
            assertEquals("not composed", 404, off.shouldInterceptRequest(webClosed, request(rpcHistory))!!.statusCode)
            assertEquals(1, reads.size)
        } finally { screen.destroy(); closed.destroy(); activity.pause().stop().destroy() }
    }
    @Test fun `only the current WebView main asset page reaches the bridge and the reply is not cached`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup()
        val commands = mutableListOf<String>()
        val screen = DebugWebScreen(activity.get(), "BridgeTest", host, "inspection", emptyMap(), inspectionBridge = { commands += it; """{"ok":true}""" })
        val web = screen.create("capture=1")
        try {
            val client = shadowOf(web).webViewClient!!
            client.onPageStarted(web, page, null)
            val reply = client.shouldInterceptRequest(web, request(rpc))!!
            assertEquals(200, reply.statusCode); assertEquals("application/json", reply.mimeType)
            assertEquals("no-store", reply.responseHeaders!!["Cache-Control"])
            assertEquals("""{"ok":true}""", reply.data!!.bufferedReader().readText())
            assertEquals(listOf("""{"op":"poll"}"""), commands)
            for ((name, denied) in listOf(
                "no referer" to request(rpc, referer = null), "other page" to request(rpc, referer = "https://$host/other.html"),
                "remote referer" to request(rpc, referer = "https://evil.invalid/index.html"), "main frame" to request(rpc, mainFrame = true),
                "post" to request(rpc, method = "POST"), "remote host" to request(rpc.replace(host, "evil.invalid")),
                "extra parameter" to request("$rpc&result=1"), "no command" to request("https://$host/native-inspection-v1"))) {
                assertEquals(name, 404, client.shouldInterceptRequest(web, denied)!!.statusCode)
            }
            assertEquals("a different WebView", 404, client.shouldInterceptRequest(WebView(activity.get()), request(rpc))!!.statusCode)
            client.onPageStarted(web, "https://$host/other.html", null)
            assertEquals("navigated page", 404, client.shouldInterceptRequest(web, request(rpc))!!.statusCode)
            assertEquals(1, commands.size)
            client.onPageStarted(web, page, null); screen.destroy()
            assertEquals("destroyed", 404, client.shouldInterceptRequest(web, request(rpc))!!.statusCode)
            assertEquals(1, commands.size)
        } finally { screen.destroy(); activity.pause().stop().destroy() }
    }
    @Test fun `a screen without a bridge exposes no channel`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup()
        val screen = DebugWebScreen(activity.get(), "BridgeTest", host, "inspection", emptyMap())
        val web = screen.create("")
        try {
            val client = shadowOf(web).webViewClient!!
            client.onPageStarted(web, page, null)
            assertEquals(404, client.shouldInterceptRequest(web, request(rpc))!!.statusCode)
        } finally { screen.destroy(); activity.pause().stop().destroy() }
    }
}
