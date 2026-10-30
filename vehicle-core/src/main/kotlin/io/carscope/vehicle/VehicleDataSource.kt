package io.carscope.vehicle

enum class DataOrigin { MOCK, PLEOS }
enum class DoorId { FRONT_LEFT, FRONT_RIGHT, REAR_LEFT, REAR_RIGHT }
enum class DoorPosition { OPEN, CLOSED }
enum class UnavailableReason { UNSUPPORTED, PERMISSION_DENIED, DISCONNECTED, UNKNOWN }

sealed interface Reading<out T> {
    /** Observation time in non-negative Unix epoch milliseconds, not the render/read time. */
    data class Available<T>(val value: T, val observedAtMillis: Long) : Reading<T>
    data class Unavailable(val reason: UnavailableReason) : Reading<Nothing>
}

data class VehicleSnapshot(
    val origin: DataOrigin,
    val doors: Map<DoorId, Reading<DoorPosition>>,
)

/**
 * Returns an immediate, non-blocking snapshot. Missing keys mean unknown, never closed.
 * A future asynchronous SDK adapter must cache callbacks, preserve observation times,
 * and return Unavailable before its first successful observation. No control methods.
 * Adapters must translate null/unknown SDK values and expected service/permission errors
 * into Unavailable, without fabricating CLOSED or falling back to MOCK. Unexpected
 * programming errors are not silently swallowed by the mapper or renderer.
 */
interface VehicleDataSource {
    fun readSnapshot(): VehicleSnapshot
}
