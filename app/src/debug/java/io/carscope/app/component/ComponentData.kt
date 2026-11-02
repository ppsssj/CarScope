package io.carscope.app.component

import java.util.Collections

internal enum class ComponentFeature(val id: String, val partId: String, val domain: String, val subscribed: Boolean) {
    WASHER("safety.washer-fluid-warning", "washer-fluid-cap", "Safety", true),
    BRAKE("safety.brake-fluid-level", "brake-fluid-reservoir", "Safety", true),
    SOC("ev-battery.soc", "ev-battery.pack", "EvBattery", true),
    CHARGE_SWITCH("ev-battery.charge-switch", "ev-battery.pack", "EvBattery", false)
}
internal enum class ComponentStatus { UNVERIFIED, SUPPORTED, UNSUPPORTED, UNAVAILABLE, PERMISSION_DENIED, ERROR, STALE }
internal sealed interface ComponentValue {
    data class Flag(val value: Boolean) : ComponentValue
    data class Oil(val value: String) : ComponentValue
    data class Integer(val value: Int) : ComponentValue
}
internal val OIL_STATES = setOf("LOW", "HIGH", "NORMAL", "ERROR", "CRITICALLY_LOW")
internal data class ComponentCapability(val readable: Boolean, val values: Set<String>? = null)
internal data class ComponentReading(
    val feature: ComponentFeature, val capabilityStatus: ComponentStatus = ComponentStatus.UNVERIFIED,
    val availabilityStatus: ComponentStatus = ComponentStatus.UNVERIFIED, val value: ComponentValue? = null,
    val observedAt: Long? = null, val source: String = "PLEOS", val reason: String = "NOT_OBSERVED"
) {
    fun at(now: Long): ComponentReading {
        val observed = observedAt ?: return this
        return if (now < 0 || observed < 0 || now < observed) copy(availabilityStatus = ComponentStatus.ERROR, value = null, observedAt = null, reason = "INVALID_CLOCK")
        else if (now - observed > 5000) copy(availabilityStatus = ComponentStatus.STALE) else this
    }
}
internal class ComponentSnapshot(rows: Map<ComponentFeature, ComponentReading>) {
    val readings: Map<ComponentFeature, ComponentReading> = Collections.unmodifiableMap(rows.toMap())
    init {
        require(readings.keys == ComponentFeature.entries.toSet())
        require(readings.all { (f, r) -> f == r.feature } && readings.values.map { it.source }.toSet().size == 1)
        require(readings.values.all { it.source in setOf("PLEOS", "MOCK") })
    }
    fun at(now: Long) = ComponentSnapshot(readings.mapValues { it.value.at(now) })
    companion object { fun empty(reason: String = "NOT_OBSERVED") = ComponentSnapshot(ComponentFeature.entries.associateWith { ComponentReading(it, reason = reason) }) }
}
