package io.carscope.app.sync

import java.net.URI
import java.security.MessageDigest
import java.time.Instant

/** Debug-only typed boundary. A future HTTP decoder must reject unknown wire fields before building these values. */
internal enum class SyncSessionState { CREATED, CLAIMED, RESULT_SUBMITTED, ACCEPTED, CANCELLED, EXPIRED }
internal enum class ReportedStatus { OK, NEEDS_REFILL, UNSURE }
internal enum class SyncFailure { NETWORK, TIMEOUT, UNAUTHORIZED, EXPIRED, CLOSED, CONFLICT, INVALID, RATE_LIMITED, SERVER }

internal class ReceiverCredential(private val value: String) {
    fun authorizationValue(): String = value
    fun valid(): Boolean = TOKEN.matches(value)
    override fun toString(): String = "ReceiverCredential(REDACTED)"
}
internal class InviteCredential(private val value: String) {
    fun fragment(): String = "#v=2&task=washer-fluid&invite=$value"
    fun valid(): Boolean = TOKEN.matches(value)
    override fun toString(): String = "InviteCredential(REDACTED)"
}
private val TOKEN = Regex("[A-Za-z0-9_-]{43}")
internal class SyncQrPayload(val value: String) {
    override fun toString(): String = "SyncQrPayload(REDACTED)"
}
internal class CreatedSyncSession(
    val sessionId: String, val receiver: ReceiverCredential, val invite: InviteCredential,
    val inviteExpiresAt: Long, val expiresAt: Long, val taskId: String = "washer-fluid"
) {
    override fun toString(): String = "CreatedSyncSession(REDACTED)"
}
internal data class ReceiverSession(val expiresAt: Long, val qr: SyncQrPayload, val inviteExpiresAt: Long = expiresAt)

internal data class CompletedInspection(
    val inspectionId: String, val startedAt: String, val completedAt: String,
    val status: ReportedStatus, val cameraUsed: Boolean, val locationMarked: Boolean
) {
    fun valid(): Boolean = try {
        Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}").matches(inspectionId) &&
            !Instant.parse(completedAt).isBefore(Instant.parse(startedAt))
    } catch (_: Exception) { false }

    // The only variable strings are validated UUID/ISO timestamps. Escape JSON strings before hashing.
    private fun quote(s: String): String = "\"" + s.flatMap { c -> when (c) {
        '\\' -> "\\\\".toList(); '"' -> "\\\"".toList()
        else -> if (c.code < 32) "\\u%04x".format(c.code).toList() else listOf(c)
    } }.joinToString("") + "\""
    fun canonicalJson(): String = "{\"aids\":{\"cameraUsed\":$cameraUsed,\"locationMarked\":$locationMarked}," +
        "\"completedAt\":${quote(completedAt)},\"confirmation\":\"USER_REPORTED\",\"inspectionId\":${quote(inspectionId)}," +
        "\"method\":\"SELF\",\"schemaVersion\":1,\"source\":\"MOBILE\",\"startedAt\":${quote(startedAt)}," +
        "\"state\":\"COMPLETED\",\"status\":\"${status.name}\",\"sync\":\"NOT_SENT\",\"taskId\":\"washer-fluid\"}"
    fun digest(): String = "sha256:" + MessageDigest.getInstance("SHA-256").digest(canonicalJson().toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
}
internal data class SyncReceiverView(
    val sessionId: String, val sessionState: SyncSessionState, val expiresAt: Long,
    val result: CompletedInspection? = null, val resultDigest: String? = null, val taskId: String = "washer-fluid"
)
internal sealed class SyncReply<out T> {
    data class Success<T>(val value: T) : SyncReply<T>()
    data class Failure(val reason: SyncFailure) : SyncReply<Nothing>()
}

/** No HTTP implementation is enabled. Android networking, real auth and trusted HTTPS remain integration gates. */
internal interface SyncReceiverTransport {
    fun create(callback: (SyncReply<CreatedSyncSession>) -> Unit): SyncCancellation
    fun view(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation
    fun accept(id: String, receiver: ReceiverCredential, digest: String, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation
    fun cancel(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation
}
internal fun interface SyncCancellation { fun cancel() }
internal fun interface SyncReceiverScheduler { fun after(delayMs: Long, action: () -> Unit): SyncCancellation }

internal fun requireHttpsMobileRoot(url: String): String {
    val uri = URI(url)
    require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path in listOf("", "/"))
    return url.trimEnd('/') + "/"
}
