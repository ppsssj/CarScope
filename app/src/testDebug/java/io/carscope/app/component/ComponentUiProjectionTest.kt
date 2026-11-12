package io.carscope.app.component

import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig
import ai.pleos.playground.vehicle.constant.control.OilLevelState
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ComponentUiProjectionTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    private fun sample() = ComponentSnapshot(ComponentFeature.entries.associateWith { f -> ComponentReading(f, ComponentStatus.SUPPORTED,
        if (f == ComponentFeature.SOC || f == ComponentFeature.ODOMETER) ComponentStatus.UNVERIFIED else ComponentStatus.SUPPORTED,
        when (f) { ComponentFeature.ODOMETER -> ComponentValue.Decimal(12345.6f); ComponentFeature.WASHER, ComponentFeature.CHARGE_SWITCH, ComponentFeature.CHARGE_PORT -> ComponentValue.Flag(false); ComponentFeature.BRAKE -> ComponentValue.Oil("LOW"); ComponentFeature.SOC -> ComponentValue.Integer(73); ComponentFeature.WIPER_FRONT, ComponentFeature.LOW_BEAM, ComponentFeature.HIGH_BEAM -> ComponentValue.Mode("OFF") },
        1000, "MOCK", "private diagnostic <script>") })
    @Test fun `public SDK access and enum declarations map without numeric ID guessing`() {
        assertTrue(componentCapability(CapabilityConfig(AccessType.READ), listOf(OilLevelState.LOW)).readable)
        assertTrue(componentCapability(CapabilityConfig(AccessType.READ_WRITE)).readable)
        for (type in AccessType.entries.filter { it !in setOf(AccessType.READ, AccessType.READ_WRITE) }) assertFalse(componentCapability(CapabilityConfig(type)).readable)
        assertEquals(OIL_STATES, OilLevelState.entries.map { it.name }.toSet())
    }
    @Test fun `actual Kotlin projection golden preserves timestamp source and raw SOC without a unit`() {
        val json = ComponentUiProjection.json(sample().at(6001), "ATTACHED", "ACTIVE", id, 1)
        val p = JsonParser.parseString(json).asJsonObject
        assertEquals(4, p["readings"].asJsonArray.size())
        assertFalse(json.contains("private diagnostic")); assertFalse(json.contains("reason")); assertFalse(json.contains("OilLevelState"))
        assertTrue(p["readings"].asJsonArray.all { it.asJsonObject["unit"].isJsonNull && it.asJsonObject["observedAt"].asLong == 1000L && it.asJsonObject["source"].asString == "MOCK" })
        val file = File("build/test-results/component-ui-v1.json"); file.parentFile!!.mkdirs(); file.writeText(json)
    }
    @Test fun `stopped owner is empty and projection rejects unknown phases IDs and invalid values`() {
        val json = ComponentUiProjection.json(null, "STOPPED", "UNRESOLVED", id, 2)
        assertTrue(JsonParser.parseString(json).asJsonObject["readings"].asJsonArray.all { it.asJsonObject["source"].isJsonNull && it.asJsonObject["value"].isJsonNull && it.asJsonObject["observedAt"].isJsonNull })
        assertThrows(IllegalArgumentException::class.java) { ComponentUiProjection.json(sample(), "STOPPED", "ACTIVE", id, 3) }
        assertThrows(IllegalArgumentException::class.java) { ComponentUiProjection.json(null, "STOPPED", "secret", id, 3) }
        assertThrows(IllegalArgumentException::class.java) { ComponentUiProjection.json(null, "STOPPED", "IDLE", "bad-id", 3) }
        val invalid = ComponentSnapshot(sample().readings.mapValues { (f, r) -> if (f == ComponentFeature.BRAKE) r.copy(value = ComponentValue.Oil("<script>")) else r })
        assertThrows(IllegalArgumentException::class.java) { ComponentUiProjection.json(invalid, "ATTACHED", "ACTIVE", id, 3) }
    }
    @Test fun `lease supersession pause resume and polling do not create extra SDK sessions`() {
        val worker = ComponentTestWorker(); val sdk = ComponentFakeSession()
        val source = PleosComponentDataSource({ sdk }, worker, { 1000 })
        val owner = ComponentOwner(source); val first = ComponentUiChannel(owner); val second = ComponentUiChannel(owner)
        first.start(); worker.drain(); assertEquals(1, sdk.initialized)
        repeat(50) { first.readJson(); first.readChargePortJson(); first.readVisibilityJson(); first.readOdometerJson() }; assertEquals(ComponentFeature.entries.size, sdk.capabilities.size); assertTrue(sdk.getters.isEmpty())
        val a = JsonParser.parseString(first.readJson()).asJsonObject
        second.start(); first.stop(); worker.drain()
        assertEquals("ATTACHED", JsonParser.parseString(second.readJson()).asJsonObject["connectionStatus"].asString)
        assertEquals("STOPPED", JsonParser.parseString(first.readJson()).asJsonObject["connectionStatus"].asString)
        second.stop(); second.start()
        val b = JsonParser.parseString(second.readJson()).asJsonObject
        assertNotEquals(a["sessionId"], b["sessionId"]); assertEquals(1, sdk.initialized)
    }
}
