package io.carscope.app.sync

import com.google.gson.Gson
import java.util.UUID

internal data class NativeInspectionRequest(val taskId: String, val localSessionId: String, val generation: Long)

/** One current WebView/Activity owns this token-free vault. No static owner, Intent authority, or JS proof input. */
internal class NativeInspectionBridge(
    private val elapsed: () -> Long,
    private val requestNative: (NativeInspectionRequest) -> Unit,
    private val resetNative: () -> Unit,
    private val reopenNative: (NativeInspectionRequest) -> Unit = {}
) {
    private val gson = Gson()
    private var active = true
    private var destroyed = false
    private var local: String? = null
    private var generation = 0L
    private var lastGeneration = 0L
    private var pendingTask: String? = null
    private var armed = false
    private val entries = linkedMapOf<String, Entry>()
    private var notice: String? = null
    private data class Entry(val binding: Map<String, Any>, val clock: SyncServerClock,
        var delivered: Boolean = false, var terminal: String? = null,
        var result: SyncInspection? = null, var proof: Map<String, Any>? = null)

    companion object {
        fun partId(task: String): String? = when (task) {
            "washer-fluid" -> "washer-fluid-cap"
            "brake-fluid" -> "brake-fluid-reservoir"
            in SyncTasks.all -> task
            else -> null
        }
        private val identifier = Regex("[A-Za-z0-9._:-]{1,128}")
    }
    @Synchronized fun handle(body: String): String {
        if (!active || body.toByteArray().size > 4096) return gson.toJson(mapOf("error" to "UNAVAILABLE"))
        return try {
            val x = SyncHttpDecoder.objectBody(body.toByteArray(Charsets.UTF_8), "application/json")
            val op = x["op"] as? String ?: error("INVALID")
            val session = x["localSessionId"] as? String ?: error("INVALID")
            val epoch = SyncHttpDecoder.number(x["generation"])
            require(identifier.matches(session) && epoch in 1..9_007_199_254_740_991L)
            fun keys(vararg names: String) { require(x.keys == setOf("op", "localSessionId", "generation", *names)) }
            if (op == "open") {
                keys()
                if (local != session || generation != epoch) {
                    require(epoch > lastGeneration)
                    clear(); local = session; generation = epoch; lastGeneration = epoch
                }
                gson.toJson(mapOf("ok" to true))
            } else {
                require(local == session && generation == epoch)
                when (op) {
                    "request" -> {
                        keys("taskId", "partId")
                        val task = x["taskId"] as? String ?: error("INVALID")
                        require(partId(task) != null && x["partId"] == partId(task))
                        val request = NativeInspectionRequest(task, session, epoch)
                        if (pendingTask == task) reopenNative(request)
                        else {
                            require(pendingTask == null && entries.size < 100)
                            pendingTask = task; armed = false; notice = null; requestNative(request)
                        }
                        gson.toJson(mapOf("ok" to true))
                    }
                    "poll" -> { keys(); poll() }
                    "verify" -> {
                        keys("bindingId", "syncSessionId", "taskId", "partId", "inspectionId", "resultDigest", "serverNow", "expiresAt")
                        val entry = entries[x["bindingId"]] ?: error("INVALID")
                        require(live(entry) && entry.delivered)
                        val proof = entry.proof ?: error("NOT_ACCEPTED")
                        val result = entry.result ?: error("NOT_ACCEPTED")
                        require(result.valid() && result.digest() == proof["resultDigest"])
                        for (key in listOf("bindingId", "syncSessionId", "taskId", "inspectionId", "resultDigest")) require(x[key] == proof[key])
                        require(x["partId"] == entry.binding["partId"])
                        for (key in listOf("serverNow", "expiresAt")) require(SyncHttpDecoder.number(x[key]) == entry.binding[key])
                        gson.toJson(mapOf("proof" to proof))
                    }
                    "close" -> { keys(); clear(); gson.toJson(mapOf("ok" to true)) }
                    else -> error("INVALID")
                }
            }
        } catch (_: Exception) { gson.toJson(mapOf("error" to "REJECTED")) }
    }
    private fun live(e: Entry): Boolean = e.terminal == null &&
        e.clock.upperNow(elapsed())?.let { it <= e.binding.getValue("expiresAt") as Long } == true
    private fun poll(): String {
        for (e in entries.values) {
            if (!live(e) && e.terminal == null) e.terminal = "EXPIRED"
            if (!e.delivered && elapsed() - e.clock.receiptElapsed > SyncServerClock.NATIVE_QUEUE_BUDGET_MS) {
                e.terminal = "CLOSED"; notice = "BINDING_DELIVERY_TIMEOUT"
            }
        }
        val bindings = entries.values.filter { it.terminal == null }.map { it.delivered = true; it.binding }
        val deliveries = entries.values.filter { live(it) && it.proof != null }.map { e ->
            val p = e.proof!!
            p.filterKeys { it in setOf("bindingId", "localSessionId", "generation", "syncSessionId", "taskId", "inspectionId", "resultDigest") } +
                ("result" to gson.fromJson(e.result!!.canonicalJson(), Any::class.java))
        }
        return gson.toJson(mapOf("bindings" to bindings, "accepted" to deliveries,
            "terminal" to entries.values.filter { it.delivered && it.terminal != null }.map {
                mapOf("bindingId" to it.binding["bindingId"], "syncSessionId" to it.binding["syncSessionId"], "state" to it.terminal)
            }, "unavailable" to notice))
    }
    /** Called only by the Native controller callback, never through handle(). */
    @Synchronized fun state(state: SyncReceiverState) {
        val task = pendingTask ?: return
        if (local == null || !active || !armed) return
        val id = state.syncSessionId
        if (state.phase == ReceiverPhase.WAITING && id != null && entries.values.none { it.binding["syncSessionId"] == id }) {
            val clock = state.clock
            if (clock == null) { notice = "SERVER_CLOCK_UNAVAILABLE"; return }
            val upper = clock.upperAtReceipt + SyncServerClock.DELIVERY_BUDGET_MS
            val expiry = state.expiresAt ?: return
            if (clock.upperNow(elapsed()) == null || upper >= expiry || elapsed() - clock.receiptElapsed > SyncServerClock.NATIVE_QUEUE_BUDGET_MS) {
                notice = "SERVER_CLOCK_UNAVAILABLE"; return
            }
            val binding = mapOf("bindingId" to UUID.randomUUID().toString(), "localSessionId" to local!!,
                "generation" to generation, "syncSessionId" to id, "taskId" to task, "partId" to partId(task)!!,
                "serverNow" to upper, "expiresAt" to expiry)
            entries[binding.getValue("bindingId") as String] = Entry(binding, clock)
        }
        val e = entries.values.find { it.binding["syncSessionId"] == id && it.binding["taskId"] == task }
        if (state.phase == ReceiverPhase.ACCEPTED) {
            // Keep the first blocking cause (e.g. SERVER_CLOCK_UNAVAILABLE) so 3D shows why Accept cannot apply.
            if (e == null || !live(e) || !state.explicitlyAccepted) { notice = notice ?: "ACCEPTED_NOT_BOUND"; return }
            val result = state.result ?: return
            val received = state.receivedAt ?: return
            val accepted = state.acceptedAt ?: return
            if (result.taskId != task || !result.valid() || result.digest() != state.digest ||
                received < e.binding.getValue("serverNow") as Long || accepted < received || accepted > e.binding.getValue("expiresAt") as Long) {
                e.terminal = "CLOSED"; notice = "INVALID_ACCEPTED_PROOF"; return
            }
            if (e.proof != null) return // Keep first proof; never increase completed count on duplicate Accept.
            if (entries.values.any { it.result?.inspectionId == result.inspectionId && it.result?.digest() != result.digest() }) {
                e.terminal = "CLOSED"; notice = "RESULT_CONFLICT"; return
            }
            e.result = result
            e.proof = e.binding.filterKeys { it != "partId" && it != "serverNow" && it != "expiresAt" } +
                mapOf("version" to 1, "proofId" to UUID.randomUUID().toString(), "sessionState" to "ACCEPTED",
                    "inspectionId" to result.inspectionId, "resultDigest" to result.digest(), "receivedAt" to received, "acceptedAt" to accepted)
            pendingTask = null
        }
        if (state.phase in listOf(ReceiverPhase.CANCELLED, ReceiverPhase.EXPIRED, ReceiverPhase.FAILED, ReceiverPhase.CLOSED)) {
            e?.terminal = when (state.phase) { ReceiverPhase.CANCELLED -> "CANCELLED"; ReceiverPhase.EXPIRED -> "EXPIRED"; else -> "CLOSED" }
            pendingTask = null
        }
    }
    @Synchronized fun clear() {
        local = null; generation = 0; pendingTask = null; armed = false; entries.clear(); notice = null; resetNative()
    }
    @Synchronized fun isCurrent(request: NativeInspectionRequest): Boolean = active && local == request.localSessionId &&
        generation == request.generation && pendingTask == request.taskId
    /** UI owner calls only after resetting the old controller generation, before the user can create a new QR. */
    @Synchronized fun arm(request: NativeInspectionRequest): Boolean {
        if (!isCurrent(request)) return false
        armed = true; return true
    }
    val blockingReason: String? @Synchronized get() = notice
    @Synchronized fun suspend() { active = false; clear() }
    @Synchronized fun resume() { if (!destroyed) active = true }
    @Synchronized fun destroy() { destroyed = true; active = false; clear() }
}
