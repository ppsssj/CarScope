package io.carscope.app.lab

import android.app.Activity
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
 * Debug-only WebView host shared by the 3D screens (P3-A5.1 lab, P3-A5.2 inspection). Same origin model as
 * [WebGlLabActivity]: JavaScript on this screen only, a private `https://<host>/` origin whose requests are answered
 * from the debug assets under [root], CSP on every response, every other request 404 and no navigation.
 * [files] maps exactly one path each to an app-private file (the third-party GLB is never bundled).
 * The page finishes the screen by navigating to `./close`; the Pleos home consumes Back on a task root.
 */
internal class DebugWebScreen(
    private val activity: Activity,
    private val tag: String,
    private val host: String,
    private val root: String,
    private val files: Map<String, File>,
    private val tireStatusJson: (() -> String)? = null,
) {
    private var view: WebView? = null

    fun create(query: String): WebView {
        val web = WebView(activity)
        view = web
        web.settings.apply {
            javaScriptEnabled = true // required for WebGL; this screen only
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
        }
        val csp = activity.assets.open("$root/csp.txt").bufferedReader().use { it.readText().trim() }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                val line = "${message.messageLevel()} ${message.message()}"
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.e(tag, line) else Log.i(tag, line)
                return true
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val url = request.url
                if (!DebugWebOrigin.trusted(url.toString(), host, request.method)) return notFound()
                val path = url.path.orEmpty().trimStart('/').ifEmpty { "index.html" }
                if (path.contains("..")) return notFound()
                if (path == "tire-status.json") {
                    if (!DebugWebOrigin.statusPath(url.toString(), host, request.method) || tireStatusJson == null) return notFound()
                    return try { ok("application/json", csp, tireStatusJson.invoke().byteInputStream(Charsets.UTF_8)) }
                    catch (_: Exception) { WebResourceResponse("text/plain", "utf-8", 503, "Unavailable", mapOf("Cache-Control" to "no-store", "Content-Security-Policy" to csp), "Unavailable".byteInputStream()) }
                }
                files[path]?.let { return fileResponse(it, csp) }
                return try {
                    ok(mimeOf(path), csp, activity.assets.open("$root/$path"))
                } catch (_: IOException) {
                    notFound()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Only the page's own close request is acted on; every other navigation is blocked.
                val url = request.url
                if (DebugWebOrigin.trusted(url.toString(), host, request.method) && url.path == "/close") activity.finish()
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The renderer (and its GL context) died; this WebView is unusable. Close the screen, keep the app.
                Log.e(tag, "lifecycle render-process-gone crashed=${detail.didCrash()} priority=${detail.rendererPriorityAtExit()}")
                this@DebugWebScreen.view = null
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                activity.finish()
                return true
            }
        }
        Log.i(tag, "lifecycle create files=${files.map { (k, f) -> "$k:${if (f.isFile) f.length() else -1}" }}")
        web.loadUrl("https://$host/index.html?$query")
        return web
    }

    fun resume() {
        view?.onResume()
        Log.i(tag, "lifecycle resume")
    }

    /** Fixed lifecycle signals only, never interpolated data or a callable JavaScript interface. */
    fun signalTireStatus(active: Boolean) {
        val event = if (active) "carscope-tire-active" else "carscope-tire-inactive"
        view?.evaluateJavascript("window.dispatchEvent(new Event('$event'))", null)
    }

    /** [disposeScript] runs while the page can still execute; it is a fallback, the page releases GL on close itself. */
    fun pause(finishing: Boolean, disposeScript: String) {
        if (finishing) view?.evaluateJavascript(disposeScript, null)
        view?.onPause()
        Log.i(tag, "lifecycle pause finishing=$finishing")
    }

    fun destroy() {
        view?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.stopLoading()
            it.destroy()
        }
        view = null
        Log.i(tag, "lifecycle destroy")
    }

    private fun fileResponse(file: File, csp: String): WebResourceResponse {
        if (!file.isFile) return notFound()
        if (file.length() > MAX_FILE_BYTES) {
            Log.e(tag, "${file.name} ${file.length()} bytes exceeds $MAX_FILE_BYTES")
            return notFound()
        }
        return ok("model/gltf-binary", csp, FileInputStream(file), file.length())
    }

    private fun ok(mime: String, csp: String, body: InputStream, length: Long? = null): WebResourceResponse {
        val headers = mutableMapOf("Content-Security-Policy" to csp, "Cache-Control" to "no-store")
        if (length != null) headers["Content-Length"] = length.toString() // lets the loader report progress
        return WebResourceResponse(mime, if (mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("svg+xml")) "utf-8" else null, 200, "OK", headers, body)
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())

    private fun mimeOf(path: String) = when (path.substringAfterLast('.')) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "svg" -> "image/svg+xml"
        else -> "text/plain"
    }

    companion object {
        const val MAX_FILE_BYTES = 32L * 1024 * 1024
        /** App-private file filled by tools/three-poc/push-android-lab-model.mjs (run-as, debuggable builds only). */
        const val MODEL_PATH = "debug-3d-assets/ioniq5.glb"
    }
}
