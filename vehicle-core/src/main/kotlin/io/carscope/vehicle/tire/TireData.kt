package io.carscope.vehicle.tire

import io.carscope.vehicle.DataOrigin

/** Wire IDs are independent of SDK area names and 3D mesh names. Left/right face forward. */
enum class TireId(val vehiclePartId: String) {
    FRONT_LEFT("tire.front-left"), FRONT_RIGHT("tire.front-right"),
    REAR_LEFT("tire.rear-left"), REAR_RIGHT("tire.rear-right");
}

enum class TireFeature(val featureId: String) {
    PRESSURE("tire.pressure"), LOW_PRESSURE("tire.low-pressure");
}

/** CarScope statuses, NOT Pleos SDK enums. SUPPORTED capability does not imply a valid observation. */
enum class TireStatus { SUPPORTED, UNSUPPORTED, PERMISSION_DENIED, UNVERIFIED, STALE, ERROR }

data class TireReading(
    val feature: TireFeature,
    val tire: TireId,
    val capabilityStatus: TireStatus = TireStatus.UNVERIFIED,
    val availabilityStatus: TireStatus = TireStatus.UNVERIFIED,
    /** Raw SDK Float only, never a converted pressure or a boolean warning. */
    val value: Float? = null,
    val unit: String? = null,
    /** App callback-receipt Unix epoch milliseconds; not vehicle hardware time. */
    val observedAt: Long? = null,
    val source: DataOrigin,
    val reason: String = "NOT_QUERIED",
) {
    val featureId: String get() = feature.featureId
    val vehiclePartId: String get() = tire.vehiclePartId
    val apiDomain: String get() = "Tire"

    init {
        require(capabilityStatus != TireStatus.STALE)
        require(observedAt == null || observedAt >= 0)
        require(value == null || (value.isFinite() && capabilityStatus == TireStatus.SUPPORTED && observedAt != null &&
            availabilityStatus in setOf(TireStatus.SUPPORTED, TireStatus.UNVERIFIED, TireStatus.STALE)))
        require(value != null || observedAt == null)
        // No verified unit in v1. Prevent accidental labelling as psi/kPa/bar.
        require(unit == null)
    }

    fun at(now: Long): TireReading {
        val time = observedAt ?: return this
        if (now < 0 || time > now) return copy(availabilityStatus = TireStatus.ERROR, value = null, observedAt = null, reason = "INVALID_CLOCK")
        return if (now - time > MAX_AGE_MILLIS) copy(availabilityStatus = TireStatus.STALE) else this
    }

    companion object {
        /** Existing CarScope conservative display policy, not an SDK update-rate guarantee. */
        const val MAX_AGE_MILLIS = 5_000L
    }
}

class TireSnapshot(readings: List<TireReading>) {
    val readings: List<TireReading> = java.util.Collections.unmodifiableList(readings.toList())
    init {
        require(readings.size == 8 && readings.map { it.feature to it.tire }.toSet().size == 8)
        require(readings.map { it.source }.toSet().size == 1)
    }
    fun at(now: Long) = TireSnapshot(readings.map { it.at(now) })
    companion object {
        fun empty(source: DataOrigin, reason: String = "NOT_QUERIED") = TireSnapshot(TireFeature.entries.flatMap { f ->
            TireId.entries.map { TireReading(f, it, source = source, reason = reason) }
        })
    }
}

interface TireDataSource { fun readSnapshot(): TireSnapshot }

/** Explicit caller-supplied synthetic observations only; no invented default tire pressure. */
class MockTireDataSource(private val snapshot: TireSnapshot, private val clock: () -> Long) : TireDataSource {
    init { require(snapshot.readings.all { it.source == DataOrigin.MOCK }) }
    override fun readSnapshot() = snapshot.at(clock())
}
