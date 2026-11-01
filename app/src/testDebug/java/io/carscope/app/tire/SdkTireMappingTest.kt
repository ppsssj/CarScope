package io.carscope.app.tire

import ai.pleos.playground.vehicle.api.model.area.WheelArea
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.constant.area.WheelValue
import io.carscope.vehicle.tire.TireId
import org.junit.Assert.*
import org.junit.Test

class SdkTireMappingTest {
    @Test fun `real AAR wheel enum values map once to canonical forward facing ids`() {
        assertEquals(listOf(WheelValue.LEFT_FRONT,WheelValue.RIGHT_FRONT,WheelValue.LEFT_REAR,WheelValue.RIGHT_REAR),TireId.entries.map { SDK_TIRE_AREAS.getValue(it).values.single() })
        val cap=mapTireCapability(AccessType.READ_WRITE,listOf(WheelArea(WheelValue.LEFT_FRONT),WheelArea(WheelValue.RIGHT_REAR)))
        assertTrue(cap.readable);assertEquals(setOf(TireId.FRONT_LEFT,TireId.REAR_RIGHT),cap.areas)
        assertFalse(mapTireCapability(AccessType.WRITE,SDK_TIRE_AREAS.values.toList()).readable)
        assertFalse(mapTireCapability(AccessType.NONE,SDK_TIRE_AREAS.values.toList()).readable)
    }
    @Test fun `combined or unknown wheel areas are never guessed into single wheel support`() {
        val cap=mapTireCapability(AccessType.READ,listOf(WheelArea(WheelValue.LEFT_FRONT,WheelValue.RIGHT_FRONT),WheelArea(WheelValue.UNKNOWN)))
        assertTrue(cap.areas.isEmpty());assertEquals(setOf(TireId.FRONT_LEFT,TireId.FRONT_RIGHT),cap.unverifiedAreas)
    }
}
