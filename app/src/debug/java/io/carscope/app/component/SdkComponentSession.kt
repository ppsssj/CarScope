package io.carscope.app.component

import android.content.Context
import android.content.pm.PackageManager
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.Safety
import ai.pleos.playground.vehicle.api.EvBattery
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig
import ai.pleos.playground.vehicle.constant.control.OilLevelState
import ai.pleos.playground.vehicle.listener.LowWasherFluidWaringListener
import ai.pleos.playground.vehicle.listener.OilLevelStateListener
import ai.pleos.playground.vehicle.listener.EvBatteryStateOfChargeListener

internal fun componentCapability(config: CapabilityConfig, values: List<OilLevelState>? = null) =
    ComponentCapability(config.accessType in setOf(AccessType.READ, AccessType.READ_WRITE), values?.map { it.name }?.toSet())

/** Only public Vehicle 2.3.2 declarations. The spelling Waring is the actual SDK spelling. */
internal class SdkComponentSession(private val context: Context) : ComponentSession {
    private val vehicle = Vehicle(context.applicationContext)
    private lateinit var safety: Safety
    private lateinit var battery: EvBattery
    private var washerListener: LowWasherFluidWaringListener? = null
    private var brakeListener: OilLevelStateListener? = null
    private var socListener: EvBatteryStateOfChargeListener? = null
    override fun initialize() { vehicle.initialize(); safety = vehicle.getSafety(); battery = vehicle.getEvBattery() }
    private fun checkPermission(f: ComponentFeature) {
        val permission = "pleos.car.permission." + if (f.domain == "Safety") "CAR_SAFETY" else "CAR_ENERGY"
        if (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) throw SecurityException("COMPONENT_PERMISSION_DENIED")
    }
    override fun capability(feature: ComponentFeature, done: (ComponentCapability?) -> Unit, failed: (Exception) -> Unit) {
        checkPermission(feature)
        val config: (CapabilityConfig) -> Unit = { done(componentCapability(it)) }
        when (feature) {
            ComponentFeature.WASHER -> safety.checkLowWasherFluidWarningStateCapabilities(config, failed)
            ComponentFeature.BRAKE -> safety.checkBrakeFluidLevelStateCapabilities({ c, values -> done(componentCapability(c, values)) }, failed)
            ComponentFeature.SOC -> battery.checkEvBatteryStateOfChargeCapabilities(config, failed)
            ComponentFeature.CHARGE_SWITCH -> battery.checkEvChargeSwitchCapabilities(config, failed)
        }
    }
    override fun read(feature: ComponentFeature, done: (ComponentValue?) -> Unit, failed: (Exception) -> Unit) {
        checkPermission(feature)
        when (feature) {
            ComponentFeature.WASHER -> safety.hasLowWasherFluidWarning({ done(it?.let { v -> ComponentValue.Flag(v) }) }, failed)
            ComponentFeature.BRAKE -> safety.getBrakeFluidLevelState({ done(it?.let { v -> ComponentValue.Oil(v.name) }) }, failed)
            ComponentFeature.SOC -> battery.getEvBatteryStateOfCharge({ done(it?.let { v -> ComponentValue.Integer(v) }) }, failed)
            ComponentFeature.CHARGE_SWITCH -> battery.getEvChargeSwitchState({ done(it?.let { v -> ComponentValue.Flag(v) }) }, failed)
        }
    }
    override fun subscribe(feature: ComponentFeature, updated: (ComponentValue?) -> Unit, failed: (Exception) -> Unit) {
        checkPermission(feature)
        when (feature) {
            ComponentFeature.WASHER -> {
                check(washerListener == null)
                val listener = object : LowWasherFluidWaringListener {
                    override fun onLowWasherFluidWaringUpdated(value: Boolean?) = updated(value?.let { v -> ComponentValue.Flag(v) })
                    override fun onFailed(e: Exception) = failed(e)
                }; washerListener = listener; safety.registerLowWasherFluidWaringState(listener)
            }
            ComponentFeature.BRAKE -> {
                check(brakeListener == null)
                val listener = object : OilLevelStateListener {
                    override fun onOilLevelUpdated(value: OilLevelState?) = updated(value?.let { ComponentValue.Oil(it.name) })
                    override fun onFailed(e: Exception) = failed(e)
                }; brakeListener = listener; safety.registerBrakeFluidLevelState(listener)
            }
            ComponentFeature.SOC -> {
                check(socListener == null)
                val listener = object : EvBatteryStateOfChargeListener {
                    override fun onEvBatteryStateOfChargeUpdated(value: Int?) = updated(value?.let { v -> ComponentValue.Integer(v) })
                    override fun onFailed(e: Exception) = failed(e)
                }; socListener = listener; battery.registerEvBatteryStateOfCharge(listener)
            }
            ComponentFeature.CHARGE_SWITCH -> error("NO_PUBLIC_CHARGE_SWITCH_LISTENER")
        }
    }
    override fun unsubscribe(feature: ComponentFeature) {
        when (feature) {
            ComponentFeature.WASHER -> washerListener?.let { safety.unregisterLowWasherFluidWaringState(it); washerListener = null }
            ComponentFeature.BRAKE -> brakeListener?.let { safety.unregisterBrakeFluidLevelState(it); brakeListener = null }
            ComponentFeature.SOC -> socListener?.let { battery.unregisterEvBatteryStateOfCharge(it); socListener = null }
            ComponentFeature.CHARGE_SWITCH -> Unit
        }
    }
    override fun release() = vehicle.release()
}
