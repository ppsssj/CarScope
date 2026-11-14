package io.carscope.app.sync

/** Receiver phase and state, shared by the Debug receiver and the bridge that the Release screen also uses. */
internal enum class ReceiverPhase { IDLE, CREATING, WAITING, RESULT_SUBMITTED, ACCEPTED, CANCELLED, EXPIRED, FAILED, CLOSED }
internal data class SyncReceiverState(
    val phase: ReceiverPhase = ReceiverPhase.IDLE, val qr: SyncQrPayload? = null,
    val result: SyncInspection? = null, val digest: String? = null,
    val busy: Boolean = false, val failure: SyncFailure? = null, val retryAvailable: Boolean = false,
    val inviteExpiresAt: Long? = null, val expiresAt: Long? = null,
    val syncSessionId: String? = null, val clock: SyncServerClock? = null,
    val receivedAt: Long? = null, val acceptedAt: Long? = null, val explicitlyAccepted: Boolean = false,
    val phoneClaimed: Boolean = false, // Display only: the server saw the invite claimed. Grants nothing.
    val autoConfirmed: Boolean = false // The approved simulator confirmed the exact digest. Never a vehicle owner's approval.
) {
    val canAccept: Boolean get() = phase == ReceiverPhase.RESULT_SUBMITTED && !busy && result != null && digest != null
    val canCancel: Boolean get() = phase in listOf(ReceiverPhase.WAITING, ReceiverPhase.RESULT_SUBMITTED) && !busy
    fun summary(): String = "모바일 셀프 점검 · 사용자 보고 결과: ${result?.statusName ?: "없음"}\n" +
        "완료 시각: ${result?.completedAt ?: "-"}\n처리 상태: ${phase.name}\n실제 차량 센서 진단이 아닙니다."
}
