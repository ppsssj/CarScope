package io.carscope.app.tire

import android.content.Context
import android.content.pm.PackageManager
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.Tire
import ai.pleos.playground.vehicle.api.model.area.WheelArea
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.constant.area.WheelValue
import ai.pleos.playground.vehicle.listener.TirePressureListener
import io.carscope.vehicle.tire.TireFeature
import io.carscope.vehicle.tire.TireId

internal val SDK_TIRE_AREAS = mapOf(
    TireId.FRONT_LEFT to WheelArea(WheelValue.LEFT_FRONT), TireId.FRONT_RIGHT to WheelArea(WheelValue.RIGHT_FRONT),
    TireId.REAR_LEFT to WheelArea(WheelValue.LEFT_REAR), TireId.REAR_RIGHT to WheelArea(WheelValue.RIGHT_REAR),
)

internal fun mapTireCapability(access: AccessType, supported: List<WheelArea>): TireCapability {
    val exact = SDK_TIRE_AREAS.filterValues { it in supported }.keys.toSet()
    val combined = SDK_TIRE_AREAS.filter { (_, single) -> supported.any { area -> area.values.size != 1 && single.values.single() in area.values } }.keys.toSet()
    return TireCapability(access == AccessType.READ || access == AccessType.READ_WRITE, exact, access.name, combined)
}

/** Verified public AAR 2.3.2 declarations only. No reflection, cancellation guess, or SET call. */
internal class SdkTireSession(private val context: Context) : TireSession {
    private val vehicle = Vehicle(context.applicationContext)
    private lateinit var tire: Tire
    private val listeners = mutableMapOf<TireId, TirePressureListener>()
    private val areas = SDK_TIRE_AREAS
    override fun initialize() { vehicle.initialize(); tire = vehicle.getTire() }
    private fun permission(f: TireFeature) = if (f == TireFeature.PRESSURE) "pleos.car.permission.PRIVATE_CAR_SAFETY" else "pleos.car.permission.CAR_SAFETY"
    private fun checkPermission(f: TireFeature) {
        if (context.checkSelfPermission(permission(f)) != PackageManager.PERMISSION_GRANTED) throw SecurityException("${permission(f)} not granted")
    }
    override fun capability(feature: TireFeature, complete: (TireCapability?) -> Unit, failed: (Exception) -> Unit) {
        checkPermission(feature)
        val done: (ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig, List<WheelArea>) -> Unit = { config, supported ->
            complete(mapTireCapability(config.accessType, supported))
        }
        if (feature == TireFeature.PRESSURE) tire.checkTirePressureCapabilities(done, failed)
        else tire.checkLowTirePressureCapabilities(done, failed)
    }
    override fun read(feature: TireFeature, tire: TireId, complete: (Float?) -> Unit, failed: (Exception) -> Unit) {
        checkPermission(feature)
        if (feature == TireFeature.PRESSURE) this.tire.getTirePressure(areas.getValue(tire), complete, failed)
        else this.tire.getLowTirePressure(areas.getValue(tire), complete, failed)
    }
    override fun subscribe(tire: TireId, updated: (Float?) -> Unit, failed: (Exception) -> Unit) {
        checkPermission(TireFeature.PRESSURE)
        check(tire !in listeners)
        val listener = object : TirePressureListener {
            override fun onTirePressureUpdated(pressure: Float?) = updated(pressure)
            override fun onFailed(e: Exception) = failed(e)
        }
        listeners[tire] = listener
        this.tire.registerTirePressure(areas.getValue(tire), listener)
    }
    override fun unsubscribe(tire: TireId) { listeners[tire]?.let { this.tire.unregisterTirePressure(areas.getValue(tire), it); listeners.remove(tire) } }
    override fun release() = vehicle.release()
}
