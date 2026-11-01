package io.carscope.app.sync

internal enum class ReceiverPhase { IDLE, CREATING, WAITING, RESULT_SUBMITTED, ACCEPTED, CANCELLED, EXPIRED, FAILED, CLOSED }
internal data class SyncReceiverState(
    val phase: ReceiverPhase = ReceiverPhase.IDLE, val qr: SyncQrPayload? = null,
    val result: CompletedInspection? = null, val digest: String? = null,
    val busy: Boolean = false, val failure: SyncFailure? = null, val retryAvailable: Boolean = false,
    val inviteExpiresAt: Long? = null, val expiresAt: Long? = null
) {
    val canAccept: Boolean get() = phase == ReceiverPhase.RESULT_SUBMITTED && !busy && result != null && digest != null
    val canCancel: Boolean get() = phase in listOf(ReceiverPhase.WAITING, ReceiverPhase.RESULT_SUBMITTED) && !busy
    fun summary(): String = "워셔액 셀프 점검 · 사용자 보고 결과: ${result?.status?.name ?: "없음"}\n" +
        "완료 시각: ${result?.completedAt ?: "-"}\n처리 상태: ${phase.name}\n실제 차량 센서 진단이 아닙니다."
}

/** Owner must call close on Activity onStop/onDestroy. Recreated owners start with fresh memory and new QR. */
internal class SyncReceiverController(
    private val client: SyncReceiverClient, private val scheduler: SyncReceiverScheduler,
    private val onState: (SyncReceiverState) -> Unit
) {
    var state = SyncReceiverState(); private set
    private var generation = 0L
    private var timer: SyncCancellation? = null
    private var request: SyncCancellation? = null
    private var errors = 0
    private var pending = false
    private fun publish(next: SyncReceiverState) { state = next; onState(state) }
    private fun stopTimer() { timer?.cancel(); timer = null }
    private fun schedule() {
        stopTimer()
        if (state.phase !in listOf(ReceiverPhase.WAITING, ReceiverPhase.RESULT_SUBMITTED) || errors >= 3) return
        val owner = generation
        timer = scheduler.after(2000L shl errors) { synchronized(this) { if (owner == generation) poll() } }
    }
    @Synchronized fun create(mobileRoot: String) {
        if (pending || state.phase !in listOf(ReceiverPhase.IDLE, ReceiverPhase.FAILED, ReceiverPhase.CANCELLED, ReceiverPhase.EXPIRED)) return
        try { requireHttpsMobileRoot(mobileRoot) } catch (_: Exception) { publish(SyncReceiverState(phase = ReceiverPhase.FAILED, failure = SyncFailure.INVALID)); return }
        val owner = ++generation
        stopTimer(); request?.cancel(); pending = true; errors = 0
        publish(SyncReceiverState(phase = ReceiverPhase.CREATING, busy = true))
        if (owner != generation) return
        request = client.create(mobileRoot) { reply -> synchronized(this) {
            if (owner != generation) return@synchronized
            pending = false
            when (reply) {
                is SyncReply.Success -> { publish(SyncReceiverState(phase = ReceiverPhase.WAITING, qr = reply.value.qr, inviteExpiresAt = reply.value.inviteExpiresAt, expiresAt = reply.value.expiresAt)); schedule() }
                is SyncReply.Failure -> publish(SyncReceiverState(phase = ReceiverPhase.FAILED, failure = reply.reason))
            }
        } }
    }
    @Synchronized fun poll() {
        if (pending || state.phase !in listOf(ReceiverPhase.WAITING, ReceiverPhase.RESULT_SUBMITTED)) return
        perform(null)
    }
    @Synchronized fun retryPolling() { errors = 0; poll() }
    @Synchronized fun accept() { if (state.canAccept && !pending) perform(true) }
    @Synchronized fun cancel() { if (state.canCancel && !pending) perform(false) }
    private fun perform(decision: Boolean?) {
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
                                result = v.result, digest = v.resultDigest, expiresAt = v.expiresAt, inviteExpiresAt = state.inviteExpiresAt))
                            if (phase in listOf(ReceiverPhase.ACCEPTED, ReceiverPhase.CANCELLED, ReceiverPhase.EXPIRED)) client.forget() else schedule()
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
    @Synchronized fun hideExpiredInvite(now: Long) {
        if (state.qr != null && state.inviteExpiresAt?.let { now > it } == true) publish(state.copy(qr = null))
    }
}
