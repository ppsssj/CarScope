package io.carscope.vehicle

import io.carscope.vehicle.tire.*
import org.junit.Assert.*
import org.junit.Test

class TireDataTest {
    private fun reading(time: Long = 100) = TireReading(TireFeature.PRESSURE, TireId.FRONT_LEFT,
        TireStatus.SUPPORTED, TireStatus.UNVERIFIED, 123f, observedAt = time, source = DataOrigin.PLEOS)

    @Test fun `stable ids are four forward facing tires with no SDK or mesh names`() {
        assertEquals(listOf("tire.front-left", "tire.front-right", "tire.rear-left", "tire.rear-right"), TireId.entries.map { it.vehiclePartId })
        assertEquals(8, TireSnapshot.empty(DataOrigin.PLEOS).readings.size)
        assertTrue(TireSnapshot.empty(DataOrigin.PLEOS).readings.all { it.value == null && it.unit == null && it.observedAt == null })
    }
    @Test fun `age boundary and read time never manufacture observations`() {
        val r = reading()
        assertEquals(TireStatus.UNVERIFIED, r.at(5100).availabilityStatus)
        assertEquals(TireStatus.STALE, r.at(5101).availabilityStatus)
        assertEquals(100L, r.at(9000).observedAt)
        assertEquals(123f, r.at(9000).value)
        assertEquals(DataOrigin.PLEOS, r.at(9000).source)
        assertEquals(TireStatus.ERROR, r.at(-1).availabilityStatus)
        assertNull(r.at(99).value)
        assertEquals(TireStatus.STALE, reading(0).at(Long.MAX_VALUE).availabilityStatus)
    }
    @Test fun `unsupported denied errors and unknown states cannot carry a fabricated zero`() {
        for (s in listOf(TireStatus.UNSUPPORTED, TireStatus.PERMISSION_DENIED, TireStatus.ERROR)) {
            try { reading().copy(availabilityStatus = s, value = 0f); fail("$s accepted data") } catch (_: IllegalArgumentException) { }
        }
        try { reading().copy(capabilityStatus = TireStatus.UNSUPPORTED); fail() } catch (_: IllegalArgumentException) { }
        try { reading().copy(unit = "kPa"); fail() } catch (_: IllegalArgumentException) { }
        try { reading().copy(value = Float.NaN); fail() } catch (_: IllegalArgumentException) { }
        try { reading().copy(observedAt = -1); fail() } catch (_: IllegalArgumentException) { }
    }
    @Test fun `snapshot is a defensive immutable copy and mixed origins are rejected`() {
        val input = TireSnapshot.empty(DataOrigin.PLEOS).readings.toMutableList()
        val snapshot = TireSnapshot(input); input.clear()
        assertEquals(8, snapshot.readings.size)
        try { (snapshot.readings as MutableList).clear(); fail() } catch (_: UnsupportedOperationException) { }
        val mixed = snapshot.readings.toMutableList(); mixed[0] = mixed[0].copy(source = DataOrigin.MOCK)
        try { TireSnapshot(mixed); fail() } catch (_: IllegalArgumentException) { }
    }
    @Test fun `mock is explicit and preserves synthetic origin and observation time`() {
        val base = TireSnapshot.empty(DataOrigin.MOCK).readings.toMutableList()
        base[0] = reading().copy(source = DataOrigin.MOCK)
        val mock = MockTireDataSource(TireSnapshot(base)) { 5101 }
        assertEquals(TireStatus.STALE, mock.readSnapshot().readings[0].availabilityStatus)
        assertEquals(100L, mock.readSnapshot().readings[0].observedAt)
        try { MockTireDataSource(TireSnapshot.empty(DataOrigin.PLEOS)) { 0 }; fail() } catch (_: IllegalArgumentException) { }
    }
}
