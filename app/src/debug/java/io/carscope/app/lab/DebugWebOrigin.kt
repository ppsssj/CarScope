package io.carscope.app.lab

import java.net.URI

/** Pure URL boundary shared by interception and navigation checks; no permissive origin matching. */
internal object DebugWebOrigin {
    fun trusted(url: String, host: String, method: String = "GET"): Boolean = try {
        val uri = URI(url)
        method == "GET" && uri.scheme == "https" && uri.host == host && uri.port in setOf(-1, 443) &&
            uri.rawUserInfo == null && uri.fragment == null && !uri.path.orEmpty().contains("..")
    } catch (_: Exception) { false }

    fun statusPath(url: String, host: String, method: String): Boolean =
        trusted(url, host, method) && URI(url).rawPath == "/tire-status.json" && URI(url).rawQuery == null
}
