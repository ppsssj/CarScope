package io.carscope.app.sync

/** Owner must call close on Activity onStop/onDestroy. Recreated owners start with fresh memory and new QR. */
internal class SyncReceiverController(
    private val client: SyncReceiverClient, private val scheduler: SyncReceiverScheduler,
    /** Only the operator-approved simulator answers true. Every other path keeps the explicit Accept. */
    private val autoConfirm: () -> Boolean = { false },
    private val onState: (SyncReceiverState) -> Unit
) {
    var state = SyncReceiverState(); private set
    private var generation = 0L
    private var timer: SyncCancellation? = null
    private var request: SyncCancellation? = null
    private var errors = 0
    private var pending = false
    private var autoAttempts = 0
    private var autoDigest: String? = null
    private fun publish(next: SyncReceiverState) { state = next; onState(state) }
    private fun stopTimer() { timer?.cancel(); timer = null }
    private fun schedule() {
        stopTimer()
        if (state.phase !in listOf(ReceiverPhase.WAITING, ReceiverPhase.RESULT_SUBMITTED) || errors >= 3) return
        val owner = generation
        timer = scheduler.after(2000L shl errors) { synchronized(this) { if (owner == generation) poll() } }
    }
    @Synchronized fun create(mobileRoot: String, taskId: String = "washer-fluid") {
        if (pending || state.phase !in listOf(ReceiverPhase.IDLE, ReceiverPhase.FAILED, ReceiverPhase.CANCELLED, ReceiverPhase.EXPIRED)) return
        try { requireHttpsMobileRoot(mobileRoot) } catch (_: Exception) { publish(SyncReceiverState(phase = ReceiverPhase.FAILED, failure = SyncFailure.INVALID)); return }
        val owner = ++generation
        stopTimer(); request?.cancel(); pending = true; errors = 0; autoAttempts = 0; autoDigest = null
        publish(SyncReceiverState(phase = ReceiverPhase.CREATING, busy = true))
        if (owner != generation) return
        request = client.create(mobileRoot, taskId) { reply -> synchronized(this) {
            if (owner != generation) return@synchronized
            pending = false
            when (reply) {
                is SyncReply.Success -> { publish(SyncReceiverState(phase = ReceiverPhase.WAITING, qr = reply.value.qr, inviteExpiresAt = reply.value.inviteExpiresAt, expiresAt = reply.value.expiresAt, syncSessionId = reply.value.sessionId, clock = reply.value.clock)); schedule() }
                is SyncReply.Failure -> publish(SyncReceiverState(phase = ReceiverPhase.FAILED, failure = reply.reason))
            }
        } }
    }
    @Synchronized fun poll() {
        if (pending || state.phase !in listOf(ReceiverPhase.WAITING, ReceiverPhase.RESULT_SUBMITTED)) return
        perform(null)
    }
    @Synchronized fun retryPolling() { errors = 0; autoAttempts = 0; poll() }
    @Synchronized fun accept() { if (state.canAccept && !pending) perform(true) }
    @Synchronized fun cancel() { if (state.canCancel && !pending) perform(false) }
    private fun perform(decision: Boolean?, automatic: Boolean = false) {
        val owner = generation; val shownDigest = state.digest
        stopTimer(); pending = true; publish(state.copy(busy = true, failure = null, retryAvailable = false))
        if (owner != generation) return
        val callback: (SyncReply<SyncReceiverView>) -> Unit = { reply -> synchronized(this) {
            if (owner == generation) {
                pending = false
                when (reply) {
                    is SyncReply.Failure -> {
                        errors++
                        val terminal = when (reply.reason) {
                            SyncFailure.EXPIRED -> ReceiverPhase.EXPIRED
                            SyncFailure.CLOSED, SyncFailure.UNAUTHORIZED, SyncFailure.INVALID, SyncFailure.CONFLICT -> ReceiverPhase.FAILED
                            else -> null
                        }
                        if (terminal != null) { client.forget(); publish(SyncReceiverState(phase = terminal, failure = reply.reason)) }
                        else { publish(state.copy(busy = false, failure = reply.reason, retryAvailable = true)); schedule() }
                    }
                    is SyncReply.Success -> {
                        val v = reply.value
                        val acceptable = decision != true || v.sessionState == SyncSessionState.ACCEPTED && v.resultDigest == shownDigest
                        val cancellable = decision != false || v.sessionState == SyncSessionState.CANCELLED
                        if (!acceptable || !cancellable) { client.forget(); publish(SyncReceiverState(phase = ReceiverPhase.FAILED, failure = SyncFailure.INVALID)) }
                        else {
                            errors = 0
                            val phase = when (v.sessionState) {
                                SyncSessionState.CREATED, SyncSessionState.CLAIMED -> ReceiverPhase.WAITING
                                SyncSessionState.RESULT_SUBMITTED -> ReceiverPhase.RESULT_SUBMITTED
                                SyncSessionState.ACCEPTED -> ReceiverPhase.ACCEPTED
                                SyncSessionState.CANCELLED -> ReceiverPhase.CANCELLED
                                SyncSessionState.EXPIRED -> ReceiverPhase.EXPIRED
                            }
                            publish(SyncReceiverState(phase = phase, qr = if (v.sessionState == SyncSessionState.CREATED) state.qr else null,
                                result = v.result ?: state.result.takeIf { phase == ReceiverPhase.ACCEPTED }, digest = v.resultDigest, expiresAt = v.expiresAt, inviteExpiresAt = state.inviteExpiresAt, syncSessionId = v.sessionId, clock = state.clock,
                                receivedAt = v.receivedAt, acceptedAt = v.acceptedAt, explicitlyAccepted = decision == true && !automatic && phase == ReceiverPhase.ACCEPTED,
                                phoneClaimed = v.sessionState == SyncSessionState.CLAIMED,
                                // A poll may be the first to see an accept whose response was lost, so it counts only for the digest sent.
                                autoConfirmed = phase == ReceiverPhase.ACCEPTED && (automatic || decision == null && autoDigest != null && v.resultDigest == autoDigest)))
                            if (phase in listOf(ReceiverPhase.ACCEPTED, ReceiverPhase.CANCELLED, ReceiverPhase.EXPIRED)) client.forget()
                            else if (phase == ReceiverPhase.RESULT_SUBMITTED && state.canAccept && autoConfirm()) {
                                if (autoAttempts < AUTO_ATTEMPTS) { autoAttempts++; autoDigest = state.digest; perform(true, automatic = true) }
                                // Out of automatic attempts: say so and offer the retry (retryPolling resets the count).
                                // Without this a successful poll cleared retryAvailable and only the Debug panel's Accept was left.
                                else { publish(state.copy(retryAvailable = true)); schedule() }
                            } else schedule()
                        }
                    }
                }
            }
        } }
        request = when (decision) { true -> client.accept(requireNotNull(shownDigest), callback); false -> client.cancel(callback); null -> client.view(callback) }
    }
    @Synchronized fun close() {
        generation++; stopTimer(); request?.cancel(); request = null; pending = false; client.forget()
        publish(SyncReceiverState(phase = ReceiverPhase.CLOSED))
    }
    @Synchronized fun reset() { close(); publish(SyncReceiverState()) }
    @Synchronized fun hideExpiredInvite(now: Long) {
        if (state.qr != null && state.inviteExpiresAt?.let { now > it } == true) publish(state.copy(qr = null))
    }
    private companion object { const val AUTO_ATTEMPTS = 3 }
}
