package io.carscope.app.component

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

/** P14: the Odometer through the existing component source. Synthetic JVM tests; no AVD claim. */
class OdometerDataTest {
    private val o = ComponentFeature.ODOMETER
    private class Fixture {
        val worker = ComponentTestWorker(); val sdk = ComponentFakeSession(); var at = 1000L
        val source = PleosComponentDataSource({ sdk }, worker, { at }); val channel = ComponentUiChannel(ComponentOwner(source))
        init { channel.start(); worker.drain() }
        fun cap(f: ComponentFeature, cap: ComponentCapability? = ComponentCapability(true)) { sdk.capabilities.getValue(f).first(cap); worker.drain() }
        fun event(f: ComponentFeature, v: ComponentValue?) { sdk.events.getValue(f).first(v); worker.drain() }
        fun row(f: ComponentFeature) = source.readSnapshot().readings.getValue(f)
        fun json() = JsonParser.parseString(channel.readOdometerJson()).asJsonObject
    }

    @Test fun `the domain permission is CAR_DRIVE, the feature is vehicle level and subscribed, and v1 channels are unchanged`() {
        assertEquals("pleos.car.permission.CAR_DRIVE", componentReadPermission(o))
        assertTrue(o.subscribed); assertEquals("vehicle.odometer", o.partId); assertEquals("odometer.distance-driven", o.id)
        assertEquals(listOf(ComponentFeature.WASHER, ComponentFeature.BRAKE, ComponentFeature.SOC, ComponentFeature.CHARGE_SWITCH), COMPONENT_UI_V1)
        assertEquals(listOf(o), ODOMETER_UI_V1); assertFalse(o in VISIBILITY_UI_V1)
        val f = Fixture(); ComponentFeature.entries.forEach { f.cap(it, ComponentCapability(true, testComponentValues(it))) }
        f.sdk.getters.getValue(o).first(ComponentValue.Decimal(12345.6f)); f.worker.drain()
        for (channel in listOf(f.channel.readJson(), f.channel.readChargePortJson(), f.channel.readVisibilityJson()))
            assertFalse(channel, channel.contains("odometer"))
        assertEquals(4, JsonParser.parseString(f.channel.readJson()).asJsonObject["readings"].asJsonArray.size())
    }

    @Test fun `a valid Float is kept raw and UNVERIFIED, sent in its own decimal form with no unit, and goes STALE after 5 s`() {
        val f = Fixture(); f.cap(o); f.sdk.getters.getValue(o).first(ComponentValue.Decimal(12345.6f)); f.worker.drain()
        assertEquals(ComponentValue.Decimal(12345.6f), f.row(o).value); assertEquals(ComponentStatus.UNVERIFIED, f.row(o).availabilityStatus)
        assertEquals("FLOAT_UNIT_AND_MEANING_UNVERIFIED", f.row(o).reason); assertEquals(1000L, f.row(o).observedAt)
        val r = f.json()["readings"].asJsonArray.single().asJsonObject
        assertEquals("12345.6", r["value"].toString()); assertTrue(r["unit"].isJsonNull); assertEquals("PLEOS", r["source"].asString)
        assertEquals("UNVERIFIED", r["availabilityStatus"].asString); assertEquals("vehicle.odometer", r["vehiclePartId"].asString)
        f.at = 6001; assertEquals(ComponentStatus.STALE, f.row(o).availabilityStatus)
        assertEquals("STALE", f.json()["readings"].asJsonArray.single().asJsonObject["availabilityStatus"].asString)
        assertEquals("observedAt is the callback time, never the read time", 1000L, f.row(o).observedAt)
    }

    @Test fun `NaN, infinity, negative and null never show a distance`() {
        for (bad in listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY, -0.5f)) {
            val f = Fixture(); f.cap(o); f.event(o, ComponentValue.Decimal(bad))
            assertNull("$bad", f.row(o).value); assertNull(f.row(o).observedAt); assertEquals("INVALID_FLOAT", f.row(o).reason)
            assertEquals(ComponentStatus.UNVERIFIED, f.row(o).availabilityStatus)
            assertTrue(f.json()["readings"].asJsonArray.single().asJsonObject["value"].isJsonNull)
        }
        val n = Fixture(); n.cap(o); n.event(o, null); assertNull(n.row(o).value); assertEquals(ComponentStatus.UNAVAILABLE, n.row(o).availabilityStatus)
        val zero = Fixture(); zero.cap(o); zero.event(o, ComponentValue.Decimal(0f)); assertEquals(ComponentValue.Decimal(0f), zero.row(o).value)
    }

    @Test fun `no read capability, a null capability, permission denial and SDK errors stay distinct and never read`() {
        val unsupported = Fixture(); unsupported.cap(o, ComponentCapability(false))
        assertEquals(ComponentStatus.UNSUPPORTED, unsupported.row(o).capabilityStatus); assertFalse(o in unsupported.sdk.getters); assertFalse(o in unsupported.sdk.events)
        val unknown = Fixture(); unknown.cap(o, null); assertEquals(ComponentStatus.UNVERIFIED, unknown.row(o).capabilityStatus); assertFalse(o in unknown.sdk.getters)
        val denied = Fixture(); denied.sdk.capabilities.getValue(o).second(SecurityException("SECRET")); denied.worker.drain()
        assertEquals(ComponentStatus.PERMISSION_DENIED, denied.row(o).capabilityStatus); assertFalse(o in denied.sdk.getters)
        val error = Fixture(); error.cap(o); error.sdk.getters.getValue(o).second(IllegalStateException()); error.worker.drain()
        assertEquals(ComponentStatus.SUPPORTED, error.row(o).capabilityStatus); assertEquals(ComponentStatus.ERROR, error.row(o).availabilityStatus)
        error.sdk.events.getValue(o).second(SecurityException()); error.worker.drain(); assertEquals(ComponentStatus.PERMISSION_DENIED, error.row(o).availabilityStatus)
        // One failing domain leaves the others alone.
        val mixed = Fixture(); mixed.sdk.capabilities.getValue(o).second(IllegalStateException()); mixed.worker.drain()
        mixed.cap(ComponentFeature.WASHER); mixed.event(ComponentFeature.WASHER, ComponentValue.Flag(true)); assertEquals(ComponentValue.Flag(true), mixed.row(ComponentFeature.WASHER).value)
    }

    @Test fun `a listener beats a late getter, duplicates are consumed once, and stop unsubscribes and drops late events`() {
        val f = Fixture(); f.cap(o)
        f.sdk.events.getValue(o).first(ComponentValue.Decimal(200f)); f.at = 2000; f.worker.drain()
        val getter = f.sdk.getters.getValue(o)
        getter.first(ComponentValue.Decimal(100f)); getter.second(IllegalStateException()); f.worker.drain()
        assertEquals("the late getter never replaces the newer event", ComponentValue.Decimal(200f), f.row(o).value); assertEquals(1000L, f.row(o).observedAt)
        assertEquals(0, f.source.diagnostics.pending - ComponentFeature.entries.count { it != o })
        val events = f.sdk.events.getValue(o)
        f.channel.stop(); f.worker.drain()
        assertTrue(o in f.sdk.unregistered)
        events.first(ComponentValue.Decimal(999f)); f.worker.drain()
        assertNull(f.row(o).value)
        assertEquals("STOPPED", f.json()["connectionStatus"].asString)
    }

    @Test fun `polling the channel reads only the cache with no second session and no extra getter`() {
        val f = Fixture(); f.cap(o); f.sdk.getters.getValue(o).first(ComponentValue.Decimal(1f)); f.worker.drain()
        val getters = f.sdk.getters.size
        repeat(50) { f.channel.readOdometerJson() }; f.worker.drain()
        assertEquals(getters, f.sdk.getters.size); assertEquals(1, f.sdk.initialized)
    }
}
