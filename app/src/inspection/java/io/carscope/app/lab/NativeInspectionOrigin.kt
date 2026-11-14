package io.carscope.app.lab

import java.net.URI

/** Dedicated asset RPC. Never a navigation, frame, remote page, generic message or result injection endpoint. */
internal object NativeInspectionOrigin {
    const val INSPECTION_PATH = "/native-inspection-v1"
    const val HISTORY_PATH = "/native-history-v1"
    fun allowed(url: String, host: String, method: String, mainFrame: Boolean, page: String?, referer: String?, path: String = INSPECTION_PATH): Boolean = try {
        fun pageAllowed(value: String?): Boolean {
            val p = URI(value ?: return false)
            return p.scheme == "https" && p.rawAuthority == host && p.rawPath == "/index.html" && p.rawFragment == null
        }
        val u = URI(url)
        method == "GET" && !mainFrame && u.scheme == "https" && u.rawAuthority == host &&
            u.rawPath == path && u.rawFragment == null &&
            u.rawQuery?.matches(Regex("command=[^&]{1,12000}")) == true && pageAllowed(page) && pageAllowed(referer)
    } catch (_: Exception) { false }
}
