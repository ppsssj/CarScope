package io.carscope.app.tire

import io.carscope.vehicle.tire.TireFeature
import io.carscope.vehicle.tire.TireId
import io.carscope.vehicle.tire.TireSnapshot
import java.util.UUID

/** Fixed, status-only projection. No Float, unit, SDK object or arbitrary reason/message crosses this boundary. */
internal object TireUiProjection {
    fun json(snapshot: TireSnapshot?, connection: String, phase: String, sessionId: String, sequence: Long): String {
        require(connection in setOf("ATTACHED", "STOPPED", "SUPERSEDED"))
        require(phase in setOf("IDLE", "ACTIVE", "STOPPING", "UNRESOLVED", "CLOSED", "UNVERIFIED"))
        require(sessionId.matches(Regex("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) && sequence in 1..9_007_199_254_740_991L)
        val rows = TireFeature.entries.flatMap { feature -> TireId.entries.map { tire ->
            val r = snapshot?.readings?.single { it.feature == feature && it.tire == tire }
            val time = r?.observedAt?.takeIf { it in 0..8_640_000_000_000_000L }?.toString() ?: "null"
            """{"featureId":"${feature.featureId}","vehiclePartId":"${tire.vehiclePartId}","capabilityStatus":"${r?.capabilityStatus?.name ?: "UNVERIFIED"}","availabilityStatus":"${r?.availabilityStatus?.name ?: "UNVERIFIED"}","observedAt":$time,"source":${r?.source?.name?.let { "\"$it\"" } ?: "null"}}"""
        } }.joinToString(",")
        return """{"schemaVersion":1,"sessionId":"$sessionId","sequence":$sequence,"connectionStatus":"$connection","sessionPhase":"$phase","readings":[$rows]}"""
    }
}

/** A WebView cache reader with a lease, not a new SDK session. All SDK calls remain on TireWorker. */
internal class TireUiChannel(private val owner: TireProbeOwner) {
    private var lease: Any? = null
    private var sessionId = UUID.randomUUID().toString()
    private var sequence = 0L

    @Synchronized fun start() {
        if (lease != null) return
        sessionId = UUID.randomUUID().toString(); sequence = 0
        lease = owner.attach().also { owner.start(it) }
    }
    @Synchronized fun stop() {
        lease?.let { owner.detach(it) }; lease = null
    }
    @Synchronized fun readJson(): String {
        val token = lease
        val snapshot = token?.let { owner.ownedSnapshot(it) }
        val connection = if (token == null) "STOPPED" else if (snapshot != null) "ATTACHED" else "SUPERSEDED"
        val phase = owner.diagnostics().phase.takeIf { it in setOf("IDLE", "ACTIVE", "STOPPING", "UNRESOLVED", "CLOSED") } ?: "UNVERIFIED"
        return TireUiProjection.json(snapshot, connection, phase, sessionId, ++sequence)
    }
}
