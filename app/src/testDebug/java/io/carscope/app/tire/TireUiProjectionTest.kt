package io.carscope.app.tire

import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.tire.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class TireUiProjectionTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    private fun sample() = TireSnapshot(TireFeature.entries.flatMap { f -> TireId.entries.map { t ->
        if (f == TireFeature.PRESSURE && t == TireId.FRONT_LEFT)
            TireReading(f, t, TireStatus.SUPPORTED, TireStatus.UNVERIFIED, 5544.125f, observedAt = 100, source = DataOrigin.MOCK, reason = "private SDK exception <script>")
        else TireReading(f, t, if (f == TireFeature.LOW_PRESSURE) TireStatus.PERMISSION_DENIED else TireStatus.UNSUPPORTED,
            if (f == TireFeature.LOW_PRESSURE) TireStatus.PERMISSION_DENIED else TireStatus.UNSUPPORTED, source = DataOrigin.MOCK)
    } })

    @Test fun `projection contains exactly eight independent status rows without value unit or reasons`() {
        val json = TireUiProjection.json(sample(), "ATTACHED", "ACTIVE", id, 1)
        assertEquals(8, Regex("\"featureId\"").findAll(json).count())
        for (t in TireId.entries) assertEquals(2, Regex(t.vehiclePartId).findAll(json).count())
        for (f in TireFeature.entries) assertEquals(4, Regex(f.featureId).findAll(json).count())
        for (secret in listOf("5544.125", "value", "unit", "reason", "private SDK", "script", "WheelArea")) assertFalse(secret, json.contains(secret))
        assertTrue(json.contains("PERMISSION_DENIED")); assertTrue(json.contains("UNSUPPORTED"))
    }
    @Test fun `stale status and actual observation time survive projection without exposing the Float`() {
        val json = TireUiProjection.json(sample().at(5101), "ATTACHED", "UNRESOLVED", id, 2)
        assertTrue(json.contains("\"availabilityStatus\":\"STALE\"")); assertTrue(json.contains("\"observedAt\":100"))
        assertFalse(json.contains("5544.125"))
        val file = File("build/test-results/tire-ui-v1.json")
        file.parentFile!!.mkdirs(); file.writeText(json) // synthetic output for the independent JS validator
    }
    @Test fun `stopped projection has no origin or prior observation and unknown diagnostics are rejected`() {
        val json = TireUiProjection.json(null, "STOPPED", "UNRESOLVED", id, 3)
        assertEquals(8, Regex("\"source\":null").findAll(json).count())
        assertEquals(8, Regex("\"observedAt\":null").findAll(json).count())
        assertThrows(IllegalArgumentException::class.java) { TireUiProjection.json(null, "fake", "IDLE", id, 1) }
        assertThrows(IllegalArgumentException::class.java) { TireUiProjection.json(null, "STOPPED", "exception text", id, 1) }
        assertThrows(IllegalArgumentException::class.java) { TireUiProjection.json(null, "STOPPED", "IDLE", "\";alert(1)", 1) }
    }
}
