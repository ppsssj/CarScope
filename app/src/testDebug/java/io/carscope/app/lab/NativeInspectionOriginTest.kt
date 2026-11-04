package io.carscope.app.lab

import org.junit.Assert.*
import org.junit.Test

class NativeInspectionOriginTest {
    @Test fun `only current main asset page may use the dedicated subresource channel`() {
        val host = "carscope-inspection.invalid"
        val page = "https://$host/index.html?capture=1"
        val url = "https://$host/native-inspection-v1?command=%7B%7D"
        assertTrue(NativeInspectionOrigin.allowed(url, host, "GET", false, page, page))
        assertFalse(NativeInspectionOrigin.allowed(url, host, "GET", true, page, page))
        assertFalse(NativeInspectionOrigin.allowed(url, host, "POST", false, page, page))
        for (bad in listOf(null, "https://evil.invalid/index.html", "http://$host/index.html", "https://$host/other.html", "https://$host:443/index.html", "$page#fake")) {
            assertFalse(NativeInspectionOrigin.allowed(url, host, "GET", false, bad, page))
            assertFalse(NativeInspectionOrigin.allowed(url, host, "GET", false, page, bad))
        }
        for (bad in listOf(url.replace(host, "evil.invalid"), "$url&extra=1", "$url#fake", url.replace("/native", "/../native")))
            assertFalse(NativeInspectionOrigin.allowed(bad, host, "GET", false, page, page))
    }
}
