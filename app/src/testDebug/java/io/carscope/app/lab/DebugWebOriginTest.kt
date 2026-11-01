package io.carscope.app.lab

import org.junit.Assert.*
import org.junit.Test

class DebugWebOriginTest {
    private val host = "carscope-inspection.invalid"
    @Test fun `status endpoint accepts only exact private https get without query fragment credentials or alternate port`() {
        assertTrue(DebugWebOrigin.statusPath("https://$host/tire-status.json", host, "GET"))
        for (url in listOf("http://$host/tire-status.json", "https://evil.invalid/tire-status.json",
            "https://$host.evil.invalid/tire-status.json", "https://$host:8443/tire-status.json",
            "https://user@$host/tire-status.json", "https://$host/tire-status.json?x=1",
            "https://$host/tire-status.json#x", "https://$host/%2e%2e/tire-status.json",
            "https://$host/tire-status%2ejson", "file:///tire-status.json", "javascript:alert(1)", "not a URI"))
            assertFalse(url, DebugWebOrigin.statusPath(url, host, "GET"))
        assertFalse(DebugWebOrigin.statusPath("https://$host/tire-status.json", host, "POST"))
        assertTrue(DebugWebOrigin.trusted("https://$host/index.html?capture=1", host))
    }
}
