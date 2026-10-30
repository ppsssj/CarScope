package io.carscope.app.identity

/** Deliberately closed allowlist: no arbitrary property IDs, enumeration or persistent IDs. */
internal enum class IdentityProperty {
    INFO_MAKE, INFO_MODEL, INFO_MODEL_TRIM, INFO_MODEL_YEAR, INFO_EXTERIOR_DIMENSIONS
}

internal data class PropertyResult(
    val property: IdentityProperty,
    val support: String,
    val permission: String,
    val status: String,
    val value: Any? = null,
    val errorType: String? = null,
    val configExposed: Boolean? = null
)

internal data class VehicleIdentity(
    val source: String,
    val make: String? = null,
    val model: String? = null,
    val trim: String? = null,
    val modelYear: Int? = null,
    val dimensionsMm: List<Int>? = null,
    val identityStatus: String,
    val oemVisualMatch: String = "UNVERIFIED"
)

internal interface IdentityReader {
    fun read(property: IdentityProperty): PropertyResult
}

internal object IdentityProbe {
    fun collect(reader: IdentityReader): List<PropertyResult> = IdentityProperty.entries.map(reader::read)

    fun failed(property: IdentityProperty, e: Exception, permission: String, config: Boolean?, temporarilyUnavailable: Boolean = false): PropertyResult {
        val (support, status) = when {
            e is SecurityException -> "UNKNOWN" to "PERMISSION_DENIED"
            e is IllegalArgumentException -> "UNSUPPORTED" to "UNSUPPORTED"
            temporarilyUnavailable -> "SUPPORTED" to "UNAVAILABLE"
            else -> "UNKNOWN" to "ERROR"
        }
        return PropertyResult(property, support, if (e is SecurityException) "DENIED" else permission,
            status, errorType = e.javaClass.simpleName, configExposed = config)
    }

    /** Preserve safe public raw values, but never use unavailable/error/type-invalid values. */
    fun available(property: IdentityProperty, value: Any?, permission: String, config: Boolean?): PropertyResult {
        val valid = when (property) {
            IdentityProperty.INFO_MAKE, IdentityProperty.INFO_MODEL, IdentityProperty.INFO_MODEL_TRIM -> value is String
            IdentityProperty.INFO_MODEL_YEAR -> value is Int
            IdentityProperty.INFO_EXTERIOR_DIMENSIONS -> value is List<*> && value.all { it is Int }
        }
        val empty = value == null || value is String && value.isBlank() || value is List<*> && value.isEmpty()
        return PropertyResult(property, "SUPPORTED", permission,
            if (empty) "EMPTY" else if (valid) "AVAILABLE" else "INVALID_TYPE",
            if (valid) value else null, configExposed = config)
    }

    fun summarize(source: String, rows: List<PropertyResult>): VehicleIdentity {
        fun value(p: IdentityProperty) = rows.singleOrNull { it.property == p && it.status == "AVAILABLE" }?.value
        fun name(p: IdentityProperty) = (value(p) as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val make = name(IdentityProperty.INFO_MAKE)
        val model = name(IdentityProperty.INFO_MODEL)
        val trim = name(IdentityProperty.INFO_MODEL_TRIM)
        val year = (value(IdentityProperty.INFO_MODEL_YEAR) as? Int)?.takeIf { it in 1886..9999 }
        val dims = (value(IdentityProperty.INFO_EXTERIOR_DIMENSIONS) as? List<*>)
            ?.takeIf { it.size == 8 && it.all { n -> n is Int && n > 0 } }?.map { it as Int }
        // API metadata alone cannot establish a real vehicle identity or match the OEM renderer.
        val status = if (make != null || model != null || trim != null || year != null || dims != null) "PARTIAL" else "UNAVAILABLE"
        return VehicleIdentity(source, make, model, trim, year, dims, status)
    }
}
