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
import ai.pleos.playground.vehicle.listener.EvChargePortOpenListener
import ai.pleos.playground.vehicle.api.model.area.WindowArea
import ai.pleos.playground.vehicle.constant.area.WindowValue
import ai.pleos.playground.vehicle.constant.control.WiperState
import ai.pleos.playground.vehicle.constant.control.LightState
import ai.pleos.playground.vehicle.listener.WiperStateListener
import ai.pleos.playground.vehicle.listener.LightStateListener

internal fun componentCapability(config: CapabilityConfig, values: List<OilLevelState>? = null) =
    ComponentCapability(config.accessType in setOf(AccessType.READ, AccessType.READ_WRITE), values?.map { it.name }?.toSet())
internal val FRONT_WIPER_AREA = WindowArea(WindowValue.FRONT_WINDSHIELD)
internal fun wiperCapability(config: CapabilityConfig, states: Map<WindowArea, List<WiperState>>?) =
    ComponentCapability(componentCapability(config).readable, states?.get(FRONT_WIPER_AREA)?.map { it.name }?.toSet() ?: if (states == null) null else emptySet())
internal fun lightCapability(config: CapabilityConfig, states: List<LightState>?) =
    ComponentCapability(componentCapability(config).readable, states?.map { it.name }?.toSet())
internal fun componentReadPermission(feature: ComponentFeature) = "pleos.car.permission." + when (feature.domain) {
    "Safety" -> "CAR_SAFETY"; "EvBattery" -> "CAR_ENERGY"; "Wiper" -> "CAR_WINDOWS"; "Light" -> "CAR_LIGHTS"; else -> error("UNVERIFIED_DOMAIN")
}

/** Only public Vehicle 2.3.2 declarations. The spelling Waring is the actual SDK spelling. */
internal class SdkComponentSession(private val context: Context) : ComponentSession {
    private val vehicle = Vehicle(context.applicationContext)
    private lateinit var safety: Safety
    private lateinit var battery: EvBattery
    private val wiper by lazy { vehicle.getWiper() }
    private val light by lazy { vehicle.getLight() }
    private var washerListener: LowWasherFluidWaringListener? = null
    private var brakeListener: OilLevelStateListener? = null
    private var socListener: EvBatteryStateOfChargeListener? = null
    private var portListener: EvChargePortOpenListener? = null
    private var wiperListener: WiperStateListener? = null
    private val lightListeners = mutableMapOf<ComponentFeature, LightStateListener>()
    override fun initialize() { vehicle.initialize(); safety = vehicle.getSafety(); battery = vehicle.getEvBattery() }
    private fun checkPermission(f: ComponentFeature) {
        val permission = componentReadPermission(f)
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
            ComponentFeature.CHARGE_PORT -> battery.checkEvChargePortOpenCapabilities(config, failed)
            ComponentFeature.WIPER_FRONT -> wiper.checkWiperStateCapabilities({ c, states -> done(wiperCapability(c, states)) }, failed)
            ComponentFeature.LOW_BEAM -> light.checkLowBeamLightStateCapabilities({ c, states -> done(lightCapability(c, states)) }, failed)
            ComponentFeature.HIGH_BEAM -> light.checkHighBeamLightStateCapabilities({ c, states -> done(lightCapability(c, states)) }, failed)
        }
    }
    override fun read(feature: ComponentFeature, done: (ComponentValue?) -> Unit, failed: (Exception) -> Unit) {
        checkPermission(feature)
        when (feature) {
            ComponentFeature.WASHER -> safety.hasLowWasherFluidWarning({ done(it?.let { v -> ComponentValue.Flag(v) }) }, failed)
            ComponentFeature.BRAKE -> safety.getBrakeFluidLevelState({ done(it?.let { v -> ComponentValue.Oil(v.name) }) }, failed)
            ComponentFeature.SOC -> battery.getEvBatteryStateOfCharge({ done(it?.let { v -> ComponentValue.Integer(v) }) }, failed)
            ComponentFeature.CHARGE_SWITCH -> battery.getEvChargeSwitchState({ done(it?.let { v -> ComponentValue.Flag(v) }) }, failed)
            ComponentFeature.CHARGE_PORT -> readPort(done, failed)
            ComponentFeature.WIPER_FRONT -> wiper.getCurrentWiperState(FRONT_WIPER_AREA, { done(it?.let { v -> ComponentValue.Mode(v.name) }) }, failed)
            ComponentFeature.LOW_BEAM -> light.getCurrentLowBeamLightState({ done(it?.let { v -> ComponentValue.Mode(v.name) }) }, failed)
            ComponentFeature.HIGH_BEAM -> light.getCurrentHighBeamLightState({ done(it?.let { v -> ComponentValue.Mode(v.name) }) }, failed)
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
            ComponentFeature.CHARGE_PORT -> subscribePort(updated, failed)
            ComponentFeature.WIPER_FRONT -> {
                check(wiperListener == null)
                val listener = object : WiperStateListener {
                    override fun onWiperStateUpdated(value: WiperState?) = updated(value?.let { ComponentValue.Mode(it.name) })
                    override fun onFailed(e: Exception) = failed(e)
                }; wiperListener = listener; wiper.registerWiperState(FRONT_WIPER_AREA, listener)
            }
            ComponentFeature.LOW_BEAM, ComponentFeature.HIGH_BEAM -> {
                check(feature !in lightListeners)
                val listener = object : LightStateListener {
                    override fun onLightStateUpdated(value: LightState?) = updated(value?.let { ComponentValue.Mode(it.name) })
                    override fun onFailed(e: Exception) = failed(e)
                }; lightListeners[feature] = listener
                if (feature == ComponentFeature.LOW_BEAM) light.registerLowBeamLightState(listener) else light.registerHighBeamLightState(listener)
            }
        }
    }
    override fun unsubscribe(feature: ComponentFeature) {
        when (feature) {
            ComponentFeature.WASHER -> washerListener?.let { safety.unregisterLowWasherFluidWaringState(it); washerListener = null }
            ComponentFeature.BRAKE -> brakeListener?.let { safety.unregisterBrakeFluidLevelState(it); brakeListener = null }
            ComponentFeature.SOC -> socListener?.let { battery.unregisterEvBatteryStateOfCharge(it); socListener = null }
            ComponentFeature.CHARGE_SWITCH -> Unit
            ComponentFeature.CHARGE_PORT -> unsubscribePort()
            ComponentFeature.WIPER_FRONT -> wiperListener?.let { wiper.unregisterWiperState(FRONT_WIPER_AREA, it); wiperListener = null }
            ComponentFeature.LOW_BEAM, ComponentFeature.HIGH_BEAM -> lightListeners[feature]?.let {
                if (feature == ComponentFeature.LOW_BEAM) light.unregisterLowBeamLightState(it) else light.unregisterHighBeamLightState(it)
                lightListeners.remove(feature)
            }
        }
    }
    override fun release() = vehicle.release()
    // Public 2.3.2 WARNING-deprecated path, permission checked by the caller. No platform fallback.
    @Suppress("DEPRECATION")
    private fun readPort(done: (ComponentValue?) -> Unit, failed: (Exception) -> Unit) =
        battery.isEvChargePortOpen({ done(it?.let { v -> ComponentValue.Flag(v) }) }, failed)
    @Suppress("DEPRECATION")
    private fun subscribePort(updated: (ComponentValue?) -> Unit, failed: (Exception) -> Unit) {
        check(portListener == null)
        val listener = object : EvChargePortOpenListener {
            override fun onEvChargePortOpenUpdated(value: Boolean?) = updated(value?.let { ComponentValue.Flag(it) })
            override fun onFailed(e: Exception) = failed(e)
        }
        portListener = listener
        battery.registerEvChargePortOpen(listener)
    }
    @Suppress("DEPRECATION")
    private fun unsubscribePort() { portListener?.let { battery.unregisterEvChargePortOpen(it); portListener = null } }
}
