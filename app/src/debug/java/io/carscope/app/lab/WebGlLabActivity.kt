package io.carscope.app.lab

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.IOException

/**
 * Debug-only WebGL experiment (P2-A2). Not reachable in release builds and not used by the main
 * screen, whose WebView keeps JavaScript disabled. Serves the Three.js PoC from the app's debug
 * assets on a private origin; every other request gets a 404, so nothing leaves the device.
 */
class WebGlLabActivity : Activity() {
    private lateinit var view: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        view = WebView(this)
        setContentView(view)
        view.settings.apply {
            javaScriptEnabled = true // required for WebGL; this screen only
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
        }
        val csp = assets.open("$ROOT/csp.txt").bufferedReader().use { it.readText().trim() }
        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i(TAG, "${message.messageLevel()} ${message.message()}")
                return true
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val url = request.url
                if (url.scheme != "https" || url.host != HOST) return notFound()
                val path = url.path.orEmpty().trimStart('/').ifEmpty { "index.html" }
                if (path.contains("..")) return notFound()
                return try {
                    WebResourceResponse(mimeOf(path), "utf-8", 200, "OK", mapOf("Content-Security-Policy" to csp, "Cache-Control" to "no-store"), assets.open("$ROOT/$path"))
                } catch (_: IOException) {
                    notFound()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        }
        val query = intent.getStringExtra("query") ?: "auto=1&cam=svg"
        view.loadUrl("https://$HOST/index.html?$query")
    }

    override fun onDestroy() {
        view.destroy()
        super.onDestroy()
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())

    private fun mimeOf(path: String) = when (path.substringAfterLast('.')) {
        "html" -> "text/html"
        "js" -> "text/javascript"
        "glb" -> "model/gltf-binary"
        else -> "text/plain"
    }

    private companion object {
        const val TAG = "CarScopeWebGL"
        const val HOST = "carscope-lab.invalid"
        const val ROOT = "webgl-lab"
    }
}
