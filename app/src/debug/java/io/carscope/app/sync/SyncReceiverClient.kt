package io.carscope.app.sync

/** Credentials never enter the display state, saved instance state, preferences or logs. */
internal class SyncReceiverClient(private val transport: SyncReceiverTransport, private val now: () -> Long) {
    private var generation = 0L
    private var id: String? = null
    private var receiver: ReceiverCredential? = null
    private var expiresAt = 0L
    private var submittedDigest: String? = null
    private var lastState: SyncSessionState? = null

    @Synchronized fun create(mobileRoot: String, callback: (SyncReply<ReceiverSession>) -> Unit): SyncCancellation {
        val root = requireHttpsMobileRoot(mobileRoot)
        forget()
        val owner = generation
        return try { transport.create { reply -> synchronized(this) {
            if (owner != generation) return@synchronized
            when (reply) {
                is SyncReply.Failure -> callback(reply)
                is SyncReply.Success -> {
                    val x = reply.value
                    if (!Regex("[0-9a-f-]{36}").matches(x.sessionId) || x.taskId != "washer-fluid" || !x.receiver.valid() || !x.invite.valid() ||
                        x.inviteExpiresAt <= now() || x.expiresAt < x.inviteExpiresAt) callback(SyncReply.Failure(SyncFailure.INVALID))
                    else {
                        id = x.sessionId; receiver = x.receiver; expiresAt = x.expiresAt
                        callback(SyncReply.Success(ReceiverSession(expiresAt, SyncQrPayload(root + x.invite.fragment()))))
                    }
                }
            }
        } } } catch (_: Exception) { callback(SyncReply.Failure(SyncFailure.NETWORK)); SyncCancellation {} }
    }
    @Synchronized private fun call(
        operation: (String, ReceiverCredential, (SyncReply<SyncReceiverView>) -> Unit) -> SyncCancellation,
        callback: (SyncReply<SyncReceiverView>) -> Unit
    ): SyncCancellation {
        val sessionId = id; val credential = receiver
        if (sessionId == null || credential == null || now() > expiresAt) {
            val reason = if (credential == null) SyncFailure.CLOSED else SyncFailure.EXPIRED
            if (reason == SyncFailure.EXPIRED) forget()
            callback(SyncReply.Failure(reason)); return SyncCancellation {}
        }
        val owner = generation
        return try { operation(sessionId, credential) { reply -> synchronized(this) {
            if (owner != generation) return@synchronized
            if (now() > expiresAt) { forget(); callback(SyncReply.Failure(SyncFailure.EXPIRED)); return@synchronized }
            if (reply is SyncReply.Success) {
                val view = reply.value
                val resultValid = view.result == null || view.result.valid() && view.result.digest() == view.resultDigest
                val requiredResult = view.sessionState != SyncSessionState.RESULT_SUBMITTED || view.result != null
                val terminalEmpty = view.sessionState !in listOf(SyncSessionState.CANCELLED, SyncSessionState.EXPIRED) || view.result == null
                val monotonic = lastState !in listOf(SyncSessionState.RESULT_SUBMITTED, SyncSessionState.ACCEPTED) || view.sessionState !in listOf(SyncSessionState.CREATED, SyncSessionState.CLAIMED)
                val immutable = submittedDigest == null || view.sessionState in listOf(SyncSessionState.CANCELLED, SyncSessionState.EXPIRED) || submittedDigest == view.resultDigest
                if (view.sessionId != sessionId || view.taskId != "washer-fluid" || view.expiresAt != expiresAt || !resultValid || !requiredResult || !terminalEmpty || !monotonic || !immutable) {
                    callback(SyncReply.Failure(SyncFailure.INVALID)); return@synchronized
                }
                if (view.sessionState in listOf(SyncSessionState.RESULT_SUBMITTED, SyncSessionState.ACCEPTED)) submittedDigest = view.resultDigest
                lastState = view.sessionState
            }
            callback(reply)
        } } } catch (_: Exception) { callback(SyncReply.Failure(SyncFailure.NETWORK)); SyncCancellation {} }
    }
    fun view(callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation = call(transport::view, callback)
    fun accept(digest: String, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation = call({ id, token, cb -> transport.accept(id, token, digest, cb) }, callback)
    fun cancel(callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation = call(transport::cancel, callback)
    @Synchronized fun forget() { generation++; id = null; receiver = null; expiresAt = 0; submittedDigest = null; lastState = null }
}
