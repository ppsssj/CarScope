package io.carscope.app.component

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ChargePortDataTest {
    private class Fixture {
        val worker = ComponentTestWorker(); val sdk = ComponentFakeSession(); var at = 1000L
        val source = PleosComponentDataSource({ sdk }, worker, { at })
        val owner = ComponentOwner(source); val channel = ComponentUiChannel(owner)
        init { channel.start(); worker.drain() }
        fun cap(c: ComponentCapability? = ComponentCapability(true)) { sdk.capabilities.getValue(ComponentFeature.CHARGE_PORT).first(c); worker.drain() }
        fun event(v: ComponentValue?) { sdk.events.getValue(ComponentFeature.CHARGE_PORT).first(v); worker.drain() }
        fun row() = source.readSnapshot().readings.getValue(ComponentFeature.CHARGE_PORT)
    }
    @Test fun `charge capability permission and unavailable getter never fabricate false`() {
        val f = Fixture(); f.cap(ComponentCapability(false)); assertFalse(f.sdk.getters.containsKey(ComponentFeature.CHARGE_PORT)); assertEquals(ComponentStatus.UNSUPPORTED, f.row().capabilityStatus)
        val n = Fixture(); n.cap(null); assertEquals(ComponentStatus.UNVERIFIED, n.row().availabilityStatus)
        val p = Fixture(); p.sdk.capabilities.getValue(ComponentFeature.CHARGE_PORT).second(SecurityException()); p.worker.drain()
        assertEquals(ComponentStatus.PERMISSION_DENIED, p.row().capabilityStatus); assertNull(p.row().value)
        val r = Fixture(); r.cap(); r.sdk.getters.getValue(ComponentFeature.CHARGE_PORT).first(null); r.worker.drain()
        assertEquals(ComponentStatus.UNAVAILABLE, r.row().availabilityStatus); assertNull(r.row().observedAt); assertEquals("PLEOS", r.row().source)
    }
    @Test fun `charge listener wins over duplicate late getter and preserves callback clock and stale`() {
        val f = Fixture(); f.cap()
        f.sdk.events.getValue(ComponentFeature.CHARGE_PORT).first(ComponentValue.Flag(true)); f.at = 2000; f.worker.drain()
        f.sdk.getters.getValue(ComponentFeature.CHARGE_PORT).first(ComponentValue.Flag(false)); f.worker.drain()
        f.sdk.getters.getValue(ComponentFeature.CHARGE_PORT).second(IllegalStateException()); f.worker.drain()
        assertEquals(ComponentValue.Flag(true), f.row().value); assertEquals(1000L, f.row().observedAt)
        f.at = 6000; assertEquals(ComponentStatus.SUPPORTED, f.row().availabilityStatus)
        f.at = 6001; assertEquals(ComponentStatus.STALE, f.row().availabilityStatus)
        f.event(ComponentValue.Oil("UNKNOWN")); assertNull(f.row().value); assertEquals(ComponentStatus.UNVERIFIED, f.row().availabilityStatus)
        f.event(null); assertEquals(ComponentStatus.UNAVAILABLE, f.row().availabilityStatus)
        f.sdk.events.getValue(ComponentFeature.CHARGE_PORT).second(IllegalStateException()); f.worker.drain()
        assertEquals(ComponentStatus.ERROR, f.row().availabilityStatus); assertNull(f.row().value)
        f.sdk.events.getValue(ComponentFeature.CHARGE_PORT).second(SecurityException()); f.worker.drain()
        assertEquals(ComponentStatus.SUPPORTED, f.row().capabilityStatus); assertEquals(ComponentStatus.PERMISSION_DENIED, f.row().availabilityStatus)
    }
    @Test fun `two projections share one lease but never extend component v1 or call the SDK on GET`() {
        val f = Fixture(); f.cap(); f.event(ComponentValue.Flag(false)); f.at = 6001
        val charge = f.channel.readChargePortJson(); val c = JsonParser.parseString(charge).asJsonObject
        val old = JsonParser.parseString(f.channel.readJson()).asJsonObject
        assertEquals(1, c["readings"].asJsonArray.size()); assertEquals(4, old["readings"].asJsonArray.size())
        assertFalse(old.toString().contains("ev-charge")); assertEquals(c["sessionId"], old["sessionId"])
        val row = c["readings"].asJsonArray[0].asJsonObject
        assertEquals("ev-charge.port-open", row["featureId"].asString); assertEquals("ev-charge.port", row["vehiclePartId"].asString)
        assertFalse(row["value"].asBoolean); assertEquals("STALE", row["availabilityStatus"].asString)
        repeat(30) { f.channel.readJson(); f.channel.readChargePortJson() }; assertEquals(1, f.sdk.initialized); assertEquals(1, f.sdk.getters.size)
        // A test projection from the actual serializer; never a runtime PLEOS claim.
        val mock = ComponentSnapshot(f.source.readSnapshot().readings.mapValues { (_, r) -> r.copy(source = "MOCK") })
        val json = ComponentUiProjection.chargePortJson(mock, "ATTACHED", "ACTIVE", "00000000-0000-4000-8000-000000000001", 1)
        val file = File("build/test-results/ev-charge-ui-v1.json"); file.parentFile!!.mkdirs(); file.writeText(json)
    }
    @Test fun `charge stop resume recreation supersedes ownership and late callbacks cannot restore values`() {
        val f = Fixture(); f.cap(); f.event(ComponentValue.Flag(true))
        f.sdk.events.getValue(ComponentFeature.CHARGE_PORT).first(ComponentValue.Flag(false)); f.channel.stop()
        val stopped = JsonParser.parseString(f.channel.readChargePortJson()).asJsonObject
        assertEquals("STOPPED", stopped["connectionStatus"].asString); assertTrue(stopped["readings"].asJsonArray[0].asJsonObject["value"].isJsonNull)
        f.worker.drain(); val other = ComponentUiChannel(f.owner); other.start(); f.worker.drain()
        assertEquals(1, f.sdk.initialized) // unresolved capability callbacks must drain before restart
        val oldId = stopped["sessionId"]; val newer = JsonParser.parseString(other.readChargePortJson()).asJsonObject
        assertNotEquals(oldId, newer["sessionId"]); assertTrue(newer["readings"].asJsonArray[0].asJsonObject["value"].isJsonNull)
        f.channel.stop(); assertEquals("ATTACHED", JsonParser.parseString(other.readChargePortJson()).asJsonObject["connectionStatus"].asString)
    }
}
