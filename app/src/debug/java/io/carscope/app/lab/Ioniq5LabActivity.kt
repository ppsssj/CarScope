package io.carscope.app.lab

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Debug-only P3-A5.1 experiment: renders the IONIQ 5 reference model with Three.js in a WebView to check
 * WebGL compatibility on the Pleos AVD. Not reachable in release builds; the main screen's WebView keeps
 * JavaScript disabled. Same origin model as [WebGlLabActivity]: a private host, page files from the
 * debug assets, every other request 404. The third-party GLB is never bundled: it is read from
 * `<app files>/debug-3d-assets/ioniq5.glb` (filled with `run-as`, debuggable builds only) and served at
 * exactly one path, `model.glb`.
 */
class Ioniq5LabActivity : Activity() {
    private var view: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        view = web
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true // required for WebGL; this screen only
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
        }
        val csp = assets.open("$ROOT/csp.txt").bufferedReader().use { it.readText().trim() }
        val model = File(filesDir, MODEL_PATH)
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                val line = "${message.messageLevel()} ${message.message()}"
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.e(TAG, line) else Log.i(TAG, line)
                return true
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val url = request.url
                if (url.scheme != "https" || url.host != HOST) return notFound()
                val path = url.path.orEmpty().trimStart('/').ifEmpty { "index.html" }
                if (path.contains("..")) return notFound()
                if (path == "model.glb") return modelResponse(model, csp)
                return try {
                    ok(mimeOf(path), csp, assets.open("$ROOT/$path"))
                } catch (_: IOException) {
                    notFound()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // The page's close button navigates here. On the Pleos home, Back on a task root is consumed by
                // the launcher, so this is the in-app way to finish. Every other navigation is blocked.
                val url = request.url
                if (url.scheme == "https" && url.host == HOST && url.path == "/close") finish()
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The renderer (and its GL context) died; this WebView is unusable. Log and close the screen
                // instead of letting the app crash.
                Log.e(TAG, "lifecycle render-process-gone crashed=${detail.didCrash()} priority=${detail.rendererPriorityAtExit()}")
                this@Ioniq5LabActivity.view = null
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                finish()
                return true
            }
        }
        Log.i(TAG, "lifecycle create model=${if (model.isFile) model.length() else -1}")
        web.loadUrl("https://$HOST/index.html?${intent.getStringExtra("query").orEmpty()}")
    }

    override fun onResume() {
        super.onResume()
        view?.onResume()
        Log.i(TAG, "lifecycle resume")
    }

    override fun onPause() {
        // Free the GL resources while the page can still run: once destroy() starts, JS no longer executes.
        if (isFinishing) view?.evaluateJavascript("window.__lab && window.__lab.dispose('finish')", null)
        view?.onPause()
        Log.i(TAG, "lifecycle pause finishing=$isFinishing")
        super.onPause()
    }

    override fun onDestroy() {
        view?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.stopLoading()
            it.destroy()
        }
        view = null
        Log.i(TAG, "lifecycle destroy")
        super.onDestroy()
    }

    private fun modelResponse(model: File, csp: String): WebResourceResponse {
        if (!model.isFile) return notFound()
        if (model.length() > MAX_MODEL_BYTES) {
            Log.e(TAG, "model ${model.length()} bytes exceeds $MAX_MODEL_BYTES")
            return notFound()
        }
        return ok("model/gltf-binary", csp, FileInputStream(model), model.length())
    }

    private fun ok(mime: String, csp: String, body: InputStream, length: Long? = null): WebResourceResponse {
        val headers = mutableMapOf("Content-Security-Policy" to csp, "Cache-Control" to "no-store")
        if (length != null) headers["Content-Length"] = length.toString() // lets the loader report progress
        return WebResourceResponse(mime, if (mime.startsWith("text/")) "utf-8" else null, 200, "OK", headers, body)
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())

    private fun mimeOf(path: String) = when (path.substringAfterLast('.')) {
        "html" -> "text/html"
        "js" -> "text/javascript"
        "css" -> "text/css"
        else -> "text/plain"
    }

    private companion object {
        const val TAG = "CarScopeIoniq5Lab"
        const val HOST = "carscope-ioniq5-lab.invalid"
        const val ROOT = "ioniq5-lab"
        const val MODEL_PATH = "debug-3d-assets/ioniq5.glb"
        const val MAX_MODEL_BYTES = 32L * 1024 * 1024
    }
}
