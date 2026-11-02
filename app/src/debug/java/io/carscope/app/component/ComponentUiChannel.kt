package io.carscope.app.component

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import java.util.UUID

internal class ComponentOwner(private val source: PleosComponentDataSource) {
    private var current: Any? = null
    @Synchronized fun attach(): Any { if (current != null) source.stop(); return Any().also { current = it } }
    @Synchronized fun start(lease: Any) { if (current === lease) source.start() }
    @Synchronized fun detach(lease: Any) { if (current === lease) { current = null; source.stop() } }
    @Synchronized fun snapshot(lease: Any): ComponentSnapshot? = if (current === lease) source.readSnapshot() else null
    fun diagnostics() = source.diagnostics
}
internal object ComponentProcessOwner {
    @Volatile private var owner: ComponentOwner? = null
    @Synchronized fun get(context: Context): ComponentOwner = owner ?: ComponentOwner(PleosComponentDataSource({ SdkComponentSession(context.applicationContext) })).also { owner = it }
}
internal object ComponentUiProjection {
    fun json(snapshot: ComponentSnapshot?, connection: String, phase: String, sessionId: String, sequence: Long): String {
        require(connection in setOf("ATTACHED", "STOPPED", "SUPERSEDED"))
        require(phase in setOf("IDLE", "ACTIVE", "STOPPING", "UNRESOLVED", "CLOSED"))
        require((snapshot != null) == (connection == "ATTACHED"))
        require(sessionId.matches(Regex("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) && sequence in 1..9_007_199_254_740_991L)
        val result = JsonObject(); result.addProperty("schemaVersion", 1); result.addProperty("sessionId", sessionId); result.addProperty("sequence", sequence)
        result.addProperty("connectionStatus", connection); result.addProperty("sessionPhase", phase)
        result.add("readings", JsonArray().apply {
            for (f in ComponentFeature.entries) add(JsonObject().apply {
                val r = snapshot?.readings?.getValue(f)
                if (r != null) {
                    require(r.capabilityStatus !in setOf(ComponentStatus.STALE, ComponentStatus.UNAVAILABLE))
                    require((r.value == null) == (r.observedAt == null))
                    require(r.observedAt == null || r.observedAt in 0..8_640_000_000_000_000L)
                    if (r.value != null) {
                        require(r.capabilityStatus == ComponentStatus.SUPPORTED)
                        require(when (f) { ComponentFeature.WASHER, ComponentFeature.CHARGE_SWITCH -> r.value is ComponentValue.Flag; ComponentFeature.BRAKE -> r.value is ComponentValue.Oil && r.value.value in OIL_STATES - "ERROR"; ComponentFeature.SOC -> r.value is ComponentValue.Integer })
                        require(r.availabilityStatus in if (f == ComponentFeature.SOC) setOf(ComponentStatus.UNVERIFIED, ComponentStatus.STALE) else setOf(ComponentStatus.SUPPORTED, ComponentStatus.STALE))
                    } else require(r.availabilityStatus !in setOf(ComponentStatus.SUPPORTED, ComponentStatus.STALE))
                }
                addProperty("featureId", f.id); addProperty("vehiclePartId", f.partId)
                addProperty("capabilityStatus", r?.capabilityStatus?.name ?: "UNVERIFIED"); addProperty("availabilityStatus", r?.availabilityStatus?.name ?: "UNVERIFIED")
                add("observedAt", r?.observedAt?.let(::JsonPrimitive) ?: JsonNull.INSTANCE)
                add("source", r?.source?.let(::JsonPrimitive) ?: JsonNull.INSTANCE)
                add("value", when (val value = r?.value) { is ComponentValue.Flag -> JsonPrimitive(value.value); is ComponentValue.Oil -> JsonPrimitive(value.value); is ComponentValue.Integer -> JsonPrimitive(value.value); null -> JsonNull.INSTANCE })
                add("unit", JsonNull.INSTANCE)
            })
        })
        return result.toString()
    }
}
internal class ComponentUiChannel(private val owner: ComponentOwner) {
    private var lease: Any? = null
    private var sessionId = UUID.randomUUID().toString()
    private var sequence = 0L
    @Synchronized fun start() { if (lease == null) { sessionId = UUID.randomUUID().toString(); sequence = 0; lease = owner.attach().also(owner::start) } }
    @Synchronized fun stop() { lease?.let(owner::detach); lease = null }
    @Synchronized fun readJson(): String {
        val token = lease
        val snapshot = token?.let(owner::snapshot)
        val connection = if (token == null) "STOPPED" else if (snapshot == null) "SUPERSEDED" else "ATTACHED"
        return ComponentUiProjection.json(snapshot, connection, owner.diagnostics().phase, sessionId, ++sequence)
    }
}
