package io.carscope.app.sync

import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import java.io.StringReader
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.Instant

/** Streaming parsing avoids coercions, duplicate fields, lenient JSON and reflection-based models. */
internal object SyncHttpDecoder {
    const val MAX_BYTES = 16 * 1024
    private val uuid = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    private val token = Regex("[A-Za-z0-9_-]{43}")
    private val digest = Regex("sha256:[0-9a-f]{64}")
    private val iso = Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z")
    private class NumberLiteral(val value: String)
    class Invalid : Exception("INVALID_SYNC_RESPONSE")
    private fun invalid(): Nothing = throw Invalid()
    private fun contentType(type: String?) {
        if (type == null || !Regex("application/json(?:\\s*;\\s*charset=utf-8)?", RegexOption.IGNORE_CASE).matches(type.trim())) invalid()
    }
    private fun read(reader: JsonReader, depth: Int = 0): Any? {
        if (depth > 8) invalid()
        return when (reader.peek()) {
            JsonToken.BEGIN_OBJECT -> {
                val fields = linkedMapOf<String, Any?>(); reader.beginObject()
                while (reader.hasNext()) { val key = reader.nextName(); if (fields.containsKey(key)) invalid(); fields[key] = read(reader, depth + 1) }
                reader.endObject(); fields
            }
            JsonToken.STRING -> reader.nextString()
            JsonToken.NUMBER -> NumberLiteral(reader.nextString())
            JsonToken.BOOLEAN -> reader.nextBoolean()
            JsonToken.NULL -> { reader.nextNull(); null }
            else -> invalid() // no arrays in any response contract
        }
    }
    internal fun objectBody(bytes: ByteArray, type: String?): Map<String, Any?> = try {
        contentType(type); if (bytes.size > MAX_BYTES) invalid()
        val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        JsonReader(StringReader(text)).use { r ->
            r.strictness = Strictness.STRICT
            val out = obj(read(r)); if (r.peek() != JsonToken.END_DOCUMENT) invalid(); out
        }
    } catch (_: Exception) { invalid() }
    private fun obj(v: Any?): Map<String, Any?> {
        if (v !is Map<*, *> || v.keys.any { it !is String }) invalid()
        @Suppress("UNCHECKED_CAST") return v as Map<String, Any?>
    }
    private fun exact(v: Map<String, Any?>, vararg fields: String) { if (v.keys != fields.toSet()) invalid() }
    private fun string(v: Any?): String = v as? String ?: invalid()
    private fun constant(v: Any?, expected: String) { if (v !is String || v != expected) invalid() }
    private fun number(v: Any?): Long {
        val n = (v as? NumberLiteral)?.value ?: invalid()
        if (!Regex("0|[1-9][0-9]*").matches(n)) invalid()
        return n.toLongOrNull()?.takeIf { it <= 9007199254740991L } ?: invalid()
    }
    private fun nullableTime(v: Any?): Long? = if (v == null) null else number(v)
    private fun id(v: Any?): String = string(v).also { if (!uuid.matches(it)) invalid() }
    private fun hash(v: Any?): String? = if (v == null) null else string(v).also { if (!digest.matches(it)) invalid() }
    private fun time(v: Any?): String = string(v).also { if (!iso.matches(it)) invalid(); Instant.parse(it) }
    private fun flag(v: Any?): Boolean = v as? Boolean ?: invalid()

    fun created(bytes: ByteArray, type: String?): CreatedSyncSession = checked {
        val x = objectBody(bytes, type)
        exact(x, "sessionId", "taskId", "receiverToken", "inviteToken", "inviteExpiresAt", "expiresAt")
        constant(x["taskId"], "washer-fluid")
        val receiver = string(x["receiverToken"]); val invite = string(x["inviteToken"])
        if (!token.matches(receiver) || !token.matches(invite) || receiver == invite) invalid()
        val inviteExpiry = number(x["inviteExpiresAt"]); val expiry = number(x["expiresAt"])
        if (inviteExpiry == 0L || expiry < inviteExpiry) invalid()
        CreatedSyncSession(id(x["sessionId"]), ReceiverCredential(receiver), InviteCredential(invite), inviteExpiry, expiry)
    }
    fun view(bytes: ByteArray, type: String?): SyncReceiverView = checked {
        val x = objectBody(bytes, type)
        exact(x, "sessionId", "taskId", "sessionState", "expiresAt", "result", "resultDigest", "receivedAt", "acceptedAt")
        constant(x["taskId"], "washer-fluid")
        val state = SyncSessionState.valueOf(string(x["sessionState"]))
        val received = nullableTime(x["receivedAt"]); val accepted = nullableTime(x["acceptedAt"])
        val result = x["result"]?.let { result(obj(it)) }; val hash = hash(x["resultDigest"])
        if (result != null && result.digest() != hash) invalid()
        when (state) {
            SyncSessionState.CREATED, SyncSessionState.CLAIMED -> if (result != null || hash != null || received != null || accepted != null) invalid()
            SyncSessionState.RESULT_SUBMITTED -> if (result == null || hash == null || received == null || accepted != null) invalid()
            SyncSessionState.ACCEPTED -> if (hash == null || received == null || accepted == null || accepted < received) invalid()
            SyncSessionState.CANCELLED -> if (result != null || hash != null || accepted != null) invalid()
            SyncSessionState.EXPIRED -> if (result != null || accepted != null || (hash == null) != (received == null)) invalid()
        }
        SyncReceiverView(id(x["sessionId"]), state, number(x["expiresAt"]), result, hash)
    }
    private fun result(x: Map<String, Any?>): CompletedInspection {
        exact(x, "schemaVersion", "inspectionId", "taskId", "method", "source", "state", "startedAt", "aids", "status", "confirmation", "completedAt", "sync")
        if (number(x["schemaVersion"]) != 1L) invalid()
        for ((key, expected) in mapOf("taskId" to "washer-fluid", "method" to "SELF", "source" to "MOBILE", "state" to "COMPLETED", "confirmation" to "USER_REPORTED", "sync" to "NOT_SENT")) constant(x[key], expected)
        val aids = obj(x["aids"]); exact(aids, "cameraUsed", "locationMarked")
        return CompletedInspection(id(x["inspectionId"]), time(x["startedAt"]), time(x["completedAt"]), ReportedStatus.valueOf(string(x["status"])), flag(aids["cameraUsed"]), flag(aids["locationMarked"])).also { if (!it.valid()) invalid() }
    }
    fun cancelled(bytes: ByteArray, type: String?, expectedId: String, expiresAt: Long): SyncReceiverView = checked {
        val x = objectBody(bytes, type); exact(x, "sessionId", "sessionState")
        if (id(x["sessionId"]) != expectedId) invalid(); constant(x["sessionState"], "CANCELLED")
        SyncReceiverView(expectedId, SyncSessionState.CANCELLED, expiresAt)
    }
    fun error(bytes: ByteArray, type: String?, status: Int): SyncFailure = checked {
        val x = objectBody(bytes, type); exact(x, "error"); val error = obj(x["error"]); exact(error, "code")
        val code = string(error["code"])
        val allowed = mapOf(400 to setOf("BAD_REQUEST"), 401 to setOf("UNAUTHORIZED"), 403 to setOf("FORBIDDEN"), 404 to setOf("NOT_FOUND"),
            409 to setOf("ALREADY_CLAIMED", "SESSION_CLOSED", "CONFLICT", "INVALID_STATE"), 410 to setOf("SESSION_EXPIRED"),
            413 to setOf("PAYLOAD_TOO_LARGE"), 415 to setOf("UNSUPPORTED_MEDIA_TYPE"), 422 to setOf("INVALID_RESULT", "TASK_MISMATCH"),
            429 to setOf("RATE_LIMITED"), 500 to setOf("INTERNAL"), 503 to setOf("CAPACITY", "INTERNAL"))
        if (code !in (allowed[status] ?: emptySet())) invalid()
        when (status) {
            401, 403, 404 -> SyncFailure.UNAUTHORIZED
            410 -> SyncFailure.EXPIRED
            429 -> SyncFailure.RATE_LIMITED
            409 -> if (code == "CONFLICT") SyncFailure.CONFLICT else if (code == "INVALID_STATE") SyncFailure.INVALID else SyncFailure.CLOSED
            500, 503 -> SyncFailure.SERVER
            else -> SyncFailure.INVALID
        }
    }
    private inline fun <T> checked(block: () -> T): T = try { block() } catch (_: Exception) { invalid() }
}
