package io.carscope.app.identity

import android.annotation.SuppressLint
import android.app.Activity
import android.car.Car
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Launch with adb; no main-screen entry, WebView, network, controls or automatic probing. */
class VehicleIdentityActivity : Activity() {
    @Volatile private var disposed = false

    @SuppressLint("SetTextI18n") // Diagnostic JSON is intentionally literal, not a localized product UI.
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = TextView(this).apply {
            textSize = 16f
            typeface = Typeface.MONOSPACE
            setPadding(24, 24, 24, 24)
            setTextIsSelectable(true)
            text = "DEBUG • Vehicle identity probe\nReading public metadata…"
        }
        setContentView(ScrollView(this).apply { addView(text) })
        Thread({
            val report = collect()
            if (!disposed) runOnUiThread {
                if (!disposed) {
                    // Private debug app data, retrievable using adb run-as; no Logcat payload.
                    File(filesDir, "vehicle-identity.json").writeText(report.toString(2))
                    text.text = "DEBUG • Read only • OEM visual match UNVERIFIED\n\n${report.toString(2)}"
                }
            }
        }, "vehicle-identity-probe").start()
    }

    private fun grant(name: String) = if (checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED) "GRANTED" else "DENIED"

    private fun collect(): JSONObject {
        val aaosGrant = grant("android.car.permission.CAR_INFO")
        val pleosGrant = grant("pleos.car.permission.CAR_INFO")
        var connection = "NOT_CONNECTED"
        var connectionError: String? = null
        var car: Car? = null
        val rows = try {
            car = Car.createCar(applicationContext)
            val manager = car?.getCarManager(Car.PROPERTY_SERVICE) as? android.car.hardware.property.CarPropertyManager
            if (manager == null) {
                connection = "MANAGER_UNAVAILABLE"
                unavailableRows(aaosGrant, connection)
            } else {
                connection = "CONNECTED"
                IdentityProbe.collect(AaosIdentityReader(manager, aaosGrant))
            }
        } catch (e: Exception) {
            connection = if (e is SecurityException) "PERMISSION_DENIED" else "ERROR"
            connectionError = e.javaClass.simpleName
            unavailableRows(aaosGrant, connection)
        } catch (e: LinkageError) {
            connection = "PUBLIC_LIBRARY_UNAVAILABLE"
            connectionError = e.javaClass.simpleName
            unavailableRows(aaosGrant, connection)
        } finally {
            try {
                car?.disconnect()
            } catch (e: Exception) {
                connectionError = e.javaClass.simpleName
                connection += ";DISCONNECT_ERROR"
            }
        }
        val pleosRows = IdentityProperty.entries.map {
            PropertyResult(it, "UNSUPPORTED", pleosGrant, "NOT_EXPOSED_BY_SDK_2_3_2")
        }
        return JSONObject().apply {
            put("schemaVersion", 1)
            put("environment", JSONObject().apply {
                put("androidApi", Build.VERSION.SDK_INT)
                put("androidRelease", Build.VERSION.RELEASE)
                put("osBuild", Build.DISPLAY) // image build label, never Build.SERIAL/ANDROID_ID
                put("deviceProduct", Build.PRODUCT) // emulator platform label, not vehicle model
                put("pleosVehicleSdk", "2.3.2")
                put("aaosCompileApi", 34)
            })
            put("aaosConnection", connection)
            put("connectionErrorType", connectionError ?: JSONObject.NULL)
            put("identities", JSONArray().put(identityJson(IdentityProbe.summarize("pleos-sdk", pleosRows)))
                .put(identityJson(IdentityProbe.summarize("aaos", rows))))
            put("availability", JSONArray().apply {
                pleosRows.forEach { put(rowJson("pleos-sdk", it)) }
                rows.forEach { put(rowJson("aaos", it)) }
            })
        }
    }

    private fun unavailableRows(permission: String, status: String) = IdentityProperty.entries.map {
        PropertyResult(it, "UNKNOWN", permission, status)
    }

    private fun identityJson(i: VehicleIdentity) = JSONObject().apply {
        put("source", i.source)
        put("make", i.make ?: JSONObject.NULL)
        put("model", i.model ?: JSONObject.NULL)
        put("trim", i.trim ?: JSONObject.NULL)
        put("modelYear", i.modelYear ?: JSONObject.NULL)
        put("dimensionsMm", i.dimensionsMm?.let(::JSONArray) ?: JSONObject.NULL)
        put("identityStatus", i.identityStatus)
        put("oemVisualMatch", i.oemVisualMatch)
    }

    private fun rowJson(source: String, r: PropertyResult) = JSONObject().apply {
        put("source", source)
        put("property", r.property.name)
        put("support", r.support)
        put("permission", r.permission)
        put("status", r.status)
        put("value", if (r.value is List<*>) JSONArray(r.value) else r.value ?: JSONObject.NULL)
        put("errorType", r.errorType ?: JSONObject.NULL)
        put("configExposed", r.configExposed ?: JSONObject.NULL)
    }

    override fun onDestroy() {
        disposed = true
        super.onDestroy()
    }
}
