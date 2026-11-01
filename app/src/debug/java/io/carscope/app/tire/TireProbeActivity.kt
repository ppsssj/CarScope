package io.carscope.app.tire

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.tire.TireSnapshot

/** Separate debug-only, read-only probe. Never changes MainActivity or selects a mock fallback. */
class TireProbeActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var owner: TireProbeOwner
    private var lease: Any? = null
    private lateinit var text: TextView
    private var last = ""
    private var active = false
    private val tick = object : Runnable {
        override fun run() { render(); handler.postDelayed(this, 1000) }
    }
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        owner = TireProcessOwner.get(applicationContext)
        text = TextView(this).apply { textSize = 14f; setPadding(24, 24, 24, 24); setTextIsSelectable(true) }
        setContentView(ScrollView(this).apply { addView(text) })
        Log.i(TAG, "lifecycle create restored=${state != null}")
    }
    override fun onStart() { super.onStart(); lease = owner.attach().also { owner.start(it) }; active = true; Log.i(TAG, "lifecycle start"); handler.post(tick) }
    override fun onStop() { active = false; handler.removeCallbacks(tick); lease?.let { owner.stop(it) }; render(); Log.i(TAG, "lifecycle stop requested"); super.onStop() }
    override fun onDestroy() { lease?.let { owner.detach(it) }; lease = null; Log.i(TAG, "lifecycle destroy; process owner retains unresolved cleanup"); super.onDestroy() }

    private fun render() {
        val token = lease ?: return
        if (!owner.owns(token)) return // an old Activity must not overwrite the current probe file
        val rows = JSONArray()
        val snapshot = if (active) owner.snapshot(token) else TireSnapshot.empty(DataOrigin.PLEOS, "SESSION_STOPPED")
        for (r in snapshot.readings) rows.put(JSONObject().apply {
            put("featureId", r.featureId); put("vehiclePartId", r.vehiclePartId); put("apiDomain", r.apiDomain)
            put("capabilityStatus", r.capabilityStatus.name); put("availabilityStatus", r.availabilityStatus.name)
            put("value", r.value ?: JSONObject.NULL); put("unit", r.unit ?: JSONObject.NULL)
            put("observedAt", r.observedAt ?: JSONObject.NULL); put("source", r.source.name); put("reason", r.reason)
        })
        val report = JSONObject().put("schemaVersion", 1).put("sdk", "2.3.2")
            .put("timestampBasis", "APP_CALLBACK_RECEIPT_UNIX_MS").put("readings", rows)
        val d = owner.diagnostics()
        report.put("internalSessionDiagnostics", JSONObject().apply {
            put("phase", d.phase); put("pendingSdkRequests", d.pendingSdkRequests)
            put("timedOutSdkRequests", d.timedOutSdkRequests); put("cleanupFailures", d.cleanupFailures)
            put("releaseAttempted", d.releaseAttempted); put("restartRequested", d.restartRequested)
            put("stopRequested", d.stopRequested)
            put("remoteCleanup", "UNVERIFIED")
        })
        val raw = report.toString()
        if (raw != last) {
            last = raw
            File(filesDir, "tire-probe-v1.json").writeText(raw)
            text.text = "Tire API · PLEOS · Debug read-only\n원시 Float, 단위·의미 미검증. 실제 타이어 진단이 아닙니다.\n\n" + report.toString(2)
            Log.i(TAG, "TIRE_SNAPSHOT $raw")
        }
    }
    companion object {
        private const val TAG = "CarScopeTire"
    }
}
