package io.carscope.app.sync

import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import java.io.ByteArrayOutputStream
import java.io.StringReader
import java.net.URI
import java.net.URLEncoder
import javax.net.ssl.HttpsURLConnection

/**
 * P9-H1: Debug read channel from the 3D page to the fixed simulator origin. The page sends identifiers; this class
 * alone holds the enrollment proof. Scope is the operator-approved registration, never a user or vehicle.
 * Runs on the WebView's worker thread, once per request. Keeps nothing and logs nothing.
 */
internal class AvdHistoryChannel(
    private val readEnrollment: () -> AvdSimulatorEnrollment?,
    private val timeoutMs: Int = 5000,
    private val connections: (URI) -> HttpsURLConnection = { it.toURL().openConnection() as HttpsURLConnection },
) {
    private companion object {
        const val MAX_REPLY_BYTES = 256 * 1024
        const val PATH = AvdSimulatorPolicy.API_ORIGIN + "/simulator/inspection-records"
        val QUERY = mapOf(
            "limit" to Regex("[1-9][0-9]{0,2}"),
            "cursor" to Regex("[A-Za-z0-9_-]{1,512}"),
            "taskId" to Regex("[a-z0-9.-]{1,64}"),
            "partId" to Regex("[a-z0-9.-]{1,64}"),
            "status" to Regex("[A-Z_]{1,32}"),
            "from" to Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"),
            "to" to Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"),
        )
        val RECORD = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
        fun unavailable(code: String) = JsonObject().apply { addProperty("unavailable", code) }.toString()
    }

    private class Invalid : Exception()

    /** Builds the target from allow-listed values only, so the page cannot choose another path, origin or header. */
    private fun target(command: String): URI {
        val x = SyncHttpDecoder.objectBody(command.toByteArray(Charsets.UTF_8), "application/json")
        return when (x["op"]) {
            "detail" -> {
                val id = x["recordId"] as? String ?: throw Invalid()
                if (x.keys != setOf("op", "recordId") || !RECORD.matches(id)) throw Invalid()
                URI("$PATH/$id")
            }
            "list" -> {
                val query = x.filterKeys { it != "op" }.map { (key, value) ->
                    val rule = QUERY[key] ?: throw Invalid()
                    if (value !is String || !rule.matches(value)) throw Invalid()
                    key + "=" + URLEncoder.encode(value, "UTF-8")
                }
                URI(if (query.isEmpty()) PATH else PATH + "?" + query.joinToString("&"))
            }
            else -> throw Invalid()
        }
    }

    private fun objectFrom(bytes: ByteArray): JsonObject =
        JsonReader(StringReader(bytes.toString(Charsets.UTF_8))).use { reader ->
            reader.setStrictness(Strictness.STRICT)
            val value = JsonParser.parseReader(reader)
            if (reader.peek() != JsonToken.END_DOCUMENT || !value.isJsonObject) throw Invalid()
            value.asJsonObject
        }

    fun handle(command: String): String {
        val uri = try { target(command) } catch (_: Exception) {
            return JsonObject().apply { addProperty("status", 400); add("body", JsonNull.INSTANCE) }.toString()
        }
        val enrollment = try { readEnrollment() } catch (_: Exception) { null } ?: return unavailable("AUTH_REQUIRED")
        var connection: HttpsURLConnection? = null
        return try {
            val c = connections(uri); connection = c
            c.requestMethod = "GET"; c.instanceFollowRedirects = false; c.useCaches = false
            c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
            c.setRequestProperty("Authorization", "Bearer " + enrollment.credential().authorizationValue())
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("Cache-Control", "no-store")
            val status = c.responseCode
            val reply = JsonObject().apply { add("status", JsonPrimitive(status)) }
            if (status != 200) {
                // The status is the whole answer. An error body is never passed on to the page.
                reply.add("body", JsonNull.INSTANCE)
                return reply.toString()
            }
            if (c.contentLengthLong > MAX_REPLY_BYTES || c.getHeaderField("Content-Encoding")?.let { it != "identity" } == true ||
                !Regex("application/json(?:\\s*;\\s*charset=utf-8)?", RegexOption.IGNORE_CASE).matches(c.contentType.orEmpty().trim())) throw Invalid()
            val bytes = ByteArrayOutputStream()
            c.inputStream.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    if (bytes.size() + n > MAX_REPLY_BYTES) throw Invalid()
                    bytes.write(buffer, 0, n)
                }
            }
            reply.add("body", objectFrom(bytes.toByteArray()))
            reply.toString()
        } catch (_: Exception) {
            unavailable("UNAVAILABLE")
        } finally {
            connection?.disconnect()
        }
    }

    override fun toString() = "AvdHistoryChannel(REDACTED)"
}
