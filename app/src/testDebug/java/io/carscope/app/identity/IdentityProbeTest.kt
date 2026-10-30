package io.carscope.app.identity

import org.junit.Assert.*
import org.junit.Test

class IdentityProbeTest {
    @Test fun `service security exception overrides preflight grant without leaking its message`() {
        val row = IdentityProbe.failed(IdentityProperty.INFO_MODEL, SecurityException("private payload"), "GRANTED", true)
        assertEquals("DENIED", row.permission)
        assertEquals("PERMISSION_DENIED", row.status)
        assertEquals("UNKNOWN", row.support)
        assertEquals("SecurityException", row.errorType)
        assertNull(row.value)
        assertFalse(row.toString().contains("private payload"))
    }

    @Test fun `unsupported temporary unavailable and internal error stay separate`() {
        val p = IdentityProperty.INFO_MODEL
        val unsupported = IdentityProbe.failed(p, IllegalArgumentException(), "GRANTED", false)
        val unavailable = IdentityProbe.failed(p, IllegalStateException(), "GRANTED", true, temporarilyUnavailable = true)
        val error = IdentityProbe.failed(p, RuntimeException(), "GRANTED", null)
        assertEquals("UNSUPPORTED", unsupported.support)
        assertEquals("UNSUPPORTED", unsupported.status)
        assertEquals("SUPPORTED", unavailable.support)
        assertEquals("UNAVAILABLE", unavailable.status)
        assertEquals("ERROR", error.status)
        assertEquals("UNKNOWN", error.support)
        assertTrue(listOf(unsupported, unavailable, error).all { it.value == null })
    }

    @Test fun `collect queries exactly the safe allowlist once`() {
        val calls = mutableListOf<IdentityProperty>()
        val rows = IdentityProbe.collect(object : IdentityReader {
            override fun read(property: IdentityProperty): PropertyResult {
                calls += property
                return PropertyResult(property, "UNKNOWN", "DENIED", "PERMISSION_DENIED")
            }
        })
        assertEquals(IdentityProperty.entries, calls)
        assertEquals(5, rows.size)
        assertEquals("UNAVAILABLE", IdentityProbe.summarize("aaos", rows).identityStatus)
    }

    @Test fun `metadata alone never verifies identity or visual match`() {
        val values = listOf("Example", "Example model", "", 2025, listOf(1500, 4500, 1800, 2000, 2700, 1500, 1500, 10000))
        val rows = IdentityProperty.entries.zip(values).map { (p, v) -> IdentityProbe.available(p, v, "GRANTED", true) }
        val result = IdentityProbe.summarize("aaos", rows)
        assertEquals("PARTIAL", result.identityStatus)
        assertEquals("UNVERIFIED", result.oemVisualMatch)
        assertNull(result.trim)
        assertEquals(4500, result.dimensionsMm!![1])
    }

    @Test fun `empty null invalid and unavailable values do not become identity`() {
        val values = listOf("  ", null, 17, 0, listOf(0, 1))
        val rows = IdentityProperty.entries.zip(values).map { (p, v) -> IdentityProbe.available(p, v, "GRANTED", true) }
        assertEquals(listOf("EMPTY", "EMPTY", "INVALID_TYPE", "AVAILABLE", "AVAILABLE"), rows.map { it.status })
        assertEquals("UNAVAILABLE", IdentityProbe.summarize("aaos", rows).identityStatus)
        val unavailable = PropertyResult(IdentityProperty.INFO_MODEL, "SUPPORTED", "GRANTED", "UNAVAILABLE", "Do not use")
        assertNull(IdentityProbe.summarize("aaos", listOf(unavailable)).model)
    }

    @Test fun `permission denied and unsupported remain distinct without invented values`() {
        val rows = listOf(
            PropertyResult(IdentityProperty.INFO_MAKE, "UNKNOWN", "DENIED", "PERMISSION_DENIED"),
            PropertyResult(IdentityProperty.INFO_MODEL, "UNSUPPORTED", "GRANTED", "UNSUPPORTED"),
            PropertyResult(IdentityProperty.INFO_MODEL_TRIM, "UNKNOWN", "GRANTED", "NOT_IN_PUBLIC_API_34")
        )
        assertEquals(3, rows.map { it.status }.distinct().size)
        val result = IdentityProbe.summarize("aaos", rows)
        assertNull(result.make)
        assertNull(result.model)
        assertNull(result.trim)
        assertEquals("UNAVAILABLE", result.identityStatus)
    }

    @Test fun `wrong dimension element types cannot reach the report`() {
        val row = IdentityProbe.available(IdentityProperty.INFO_EXTERIOR_DIMENSIONS, listOf("secret"), "GRANTED", true)
        assertEquals("INVALID_TYPE", row.status)
        assertNull(row.value)
    }
}
