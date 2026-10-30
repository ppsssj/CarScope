package io.carscope.app.identity

import android.car.VehiclePropertyIds
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.car.hardware.property.PropertyNotAvailableAndRetryException
import android.car.hardware.property.PropertyNotAvailableException

/** Uses only public API 34 stubs. Runs off the UI thread; never calls a setter/listener. */
internal class AaosIdentityReader(
    private val manager: CarPropertyManager,
    private val permission: String
) : IdentityReader {
    override fun read(property: IdentityProperty): PropertyResult {
        // INFO_MODEL_TRIM is absent from the installed API 34 public SDK. Do not substitute
        // a numeric ID or hidden API. This is an API-surface limitation, not a VHAL verdict.
        if (property == IdentityProperty.INFO_MODEL_TRIM) return PropertyResult(
            property, "UNKNOWN", permission, "NOT_IN_PUBLIC_API_34")
        val id = when (property) {
            IdentityProperty.INFO_MAKE -> VehiclePropertyIds.INFO_MAKE
            IdentityProperty.INFO_MODEL -> VehiclePropertyIds.INFO_MODEL
            IdentityProperty.INFO_MODEL_YEAR -> VehiclePropertyIds.INFO_MODEL_YEAR
            IdentityProperty.INFO_EXTERIOR_DIMENSIONS -> VehiclePropertyIds.INFO_EXTERIOR_DIMENSIONS
            IdentityProperty.INFO_MODEL_TRIM -> error("Unreachable")
        }
        var config: Boolean? = null
        return try {
            config = manager.getCarPropertyConfig(id) != null
            // A null config can mean unsupported OR inaccessible. Read the same allowlisted
            // property to distinguish explicit permission/unsupported errors, without enumeration.
            val result = manager.getProperty<Any>(id, 0)
            when (result?.status) {
                CarPropertyValue.STATUS_AVAILABLE -> {
                    val raw = result.value
                    val safe = if (raw is Array<*>) raw.toList() else if (raw is IntArray) raw.toList() else raw
                    IdentityProbe.available(property, safe, permission, config)
                }
                CarPropertyValue.STATUS_UNAVAILABLE -> PropertyResult(property, "SUPPORTED", permission, "UNAVAILABLE", configExposed = config)
                CarPropertyValue.STATUS_ERROR -> PropertyResult(property, "SUPPORTED", permission, "ERROR", configExposed = config)
                else -> PropertyResult(property, "UNKNOWN", permission, "EMPTY_RESULT", configExposed = config)
            }
        } catch (e: Exception) {
            IdentityProbe.failed(property, e, permission, config,
                e is PropertyNotAvailableException || e is PropertyNotAvailableAndRetryException)
        }
    }

    // Exception messages are intentionally never recorded: a service may include unrelated data.
}
