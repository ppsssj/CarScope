package io.carscope.app.tire

import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.tire.TireSnapshot

/** One process-owned controller, no Activity references. Superseded leases cannot stop a new owner. */
internal class TireProbeOwner(private val source: PleosTireDataSource) {
    private var current: Any? = null

    @Synchronized fun attach(): Any {
        if (current != null) source.stop()
        return Any().also { current = it }
    }
    @Synchronized fun start(lease: Any) { if (current === lease) source.start() }
    @Synchronized fun stop(lease: Any) { if (current === lease) source.stop() }
    @Synchronized fun detach(lease: Any) {
        if (current === lease) { current = null; source.stop() }
    }
    @Synchronized fun owns(lease: Any) = current === lease
    @Synchronized fun snapshot(lease: Any): TireSnapshot =
        if (current === lease) source.readSnapshot() else TireSnapshot.empty(DataOrigin.PLEOS, "OWNER_SUPERSEDED")
    @Synchronized fun ownedSnapshot(lease: Any): TireSnapshot? = if (current === lease) source.readSnapshot() else null
    fun diagnostics() = source.diagnostics
}
