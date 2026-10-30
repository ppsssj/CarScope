package io.carscope.visualization

import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.DoorId
import io.carscope.vehicle.DoorPosition
import io.carscope.vehicle.Reading
import io.carscope.vehicle.VehicleSnapshot

enum class DoorVisualState { OPEN, CLOSED, UNAVAILABLE, STALE }

data class VehicleDiagram(
    val origin: DataOrigin,
    val doors: Map<DoorId, DoorVisualState>,
)

object VehicleDiagramMapper {
    const val MAX_AGE_MILLIS = 5_000L // P0 display policy, not a Pleos sampling guarantee.

    fun map(snapshot: VehicleSnapshot, nowMillis: Long): VehicleDiagram = VehicleDiagram(
        origin = snapshot.origin,
        doors = DoorId.entries.associateWith { door ->
            when (val reading = snapshot.doors[door]) {
                is Reading.Available -> when {
                    // Validate before subtraction: Long.MIN_VALUE could otherwise overflow.
                    nowMillis < 0 || reading.observedAtMillis < 0 -> DoorVisualState.UNAVAILABLE
                    reading.observedAtMillis > nowMillis -> DoorVisualState.UNAVAILABLE
                    nowMillis - reading.observedAtMillis > MAX_AGE_MILLIS -> DoorVisualState.STALE
                    reading.value == DoorPosition.OPEN -> DoorVisualState.OPEN
                    else -> DoorVisualState.CLOSED
                }
                else -> DoorVisualState.UNAVAILABLE
            }
        },
    )
}
