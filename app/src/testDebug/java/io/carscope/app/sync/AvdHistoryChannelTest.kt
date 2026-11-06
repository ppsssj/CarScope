package io.carscope.app.sync

import com.google.gson.JsonParser
import java.io.ByteArrayInputStream
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import org.junit.Assert.*
import org.junit.Test

/** Deterministic connection fixture. Never opens a socket. */
class AvdHistoryChannelTest {
    private class Connection(uri: URI, private val status: Int, private val body: String, private val type: String?,
        private val encoding: String?, private val failure: Exception?, private val declared: Long?) : HttpsURLConnection(uri.toURL()) {
        var disconnected = false
        val sent = mutableMapOf<String, String>()
        override fun setRequestProperty(key: String, value: String) { sent[key] = value }
        override fun getResponseCode(): Int { failure?.let { throw it }; return status }
        override fun getContentType() = type
        override fun getContentLengthLong() = declared ?: body.toByteArray().size.toLong()
        override fun getHeaderField(name: String?) = if (name == "Content-Encoding") encoding else null
        override fun getInputStream() = ByteArrayInputStream(body.toByteArray())
        override fun disconnect() { disconnected = true }
        override fun connect() {}
        override fun usingProxy() = false
        override fun getCipherSuite() = "fixture"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
    }
    private val json = "application/json; charset=utf-8"
    private val record = "00000000-0000-4000-8000-0000000000aa"
    private val enrollment = AvdSimulatorEnrollment(AvdSimulatorSamples.registration, AvdSimulatorSamples.proof, 300000)
    private val opened = mutableListOf<URI>()
    private var last: Connection? = null
    private fun channel(status: Int = 200, body: String = """{"schemaVersion":1,"items":[],"page":{"limit":1,"hasMore":false,"nextCursor":null}}""",
        type: String? = json, encoding: String? = null, failure: Exception? = null, declared: Long? = null, held: AvdSimulatorEnrollment? = enrollment) =
        AvdHistoryChannel({ held }) { uri -> opened += uri; Connection(uri, status, body, type, encoding, failure, declared).also { last = it } }
    private fun reply(text: String) = JsonParser.parseString(text).asJsonObject

    @Test fun `list goes to the fixed origin with the proof and passes the body through`() {
        val out = reply(channel().handle("""{"op":"list","limit":"1","partId":"washer-fluid-cap"}"""))
        assertEquals(1, opened.size)
        assertEquals(AvdSimulatorPolicy.API_ORIGIN + "/simulator/inspection-records?limit=1&partId=washer-fluid-cap", opened[0].toString())
        assertEquals("Bearer " + AvdSimulatorSamples.proof, last!!.sent["Authorization"])
        assertFalse(last!!.instanceFollowRedirects)
        assertTrue(last!!.disconnected)
        assertEquals(200, out["status"].asInt)
        assertEquals(1, out["body"].asJsonObject["schemaVersion"].asInt)
    }

    @Test fun `detail targets one record and large values keep their exact digits`() {
        val out = reply(channel(body = """{"schemaVersion":1,"record":{"acceptedAt":9007199254740991}}""").handle("""{"op":"detail","recordId":"$record"}"""))
        assertEquals(AvdSimulatorPolicy.API_ORIGIN + "/simulator/inspection-records/$record", opened.single().toString())
        assertEquals("9007199254740991", out["body"].asJsonObject["record"].asJsonObject["acceptedAt"].asString)
    }

    @Test fun `the page cannot choose a path, query, origin or credential`() {
        for (bad in listOf("", "not json", "[]", """{"op":"verify"}""", """{"op":"detail"}""",
            """{"op":"detail","recordId":"../../v1/sessions"}""", """{"op":"detail","recordId":"$record","x":"1"}""",
            """{"op":"list","token":"x"}""", """{"op":"list","url":"https://evil.invalid"}""",
            """{"op":"list","partId":"x&limit=100"}""", """{"op":"list","partId":"x/../y"}""", """{"op":"list","limit":1}""",
            """{"op":"list","limit":"0"}""", """{"op":"list","status":"OK'--"}""", """{"op":"list","partId":"a","partId":"b"}""")) {
            val out = reply(channel().handle(bad))
            assertEquals(bad, 400, out["status"].asInt)
        }
        assertTrue("nothing was sent", opened.isEmpty())
    }

    @Test fun `no enrollment answers AUTH_REQUIRED without a request`() {
        assertEquals("AUTH_REQUIRED", reply(channel(held = null).handle("""{"op":"list"}"""))["unavailable"].asString)
        val throwing = AvdHistoryChannel({ throw IllegalStateException("secret path") }) { error("no request") }
        assertEquals("AUTH_REQUIRED", reply(throwing.handle("""{"op":"list"}"""))["unavailable"].asString)
        assertTrue(opened.isEmpty())
    }

    @Test fun `a refusal passes the status only, never the server body`() {
        for (status in listOf(400, 401, 403, 404, 429, 500, 302)) {
            val text = channel(status = status, body = """{"error":{"code":"SECRET"}}""").handle("""{"op":"list"}""")
            val out = reply(text)
            assertEquals(status, out["status"].asInt)
            assertTrue(out["body"].isJsonNull)
            assertFalse(text.contains("SECRET"))
        }
    }

    @Test fun `broken or oversized replies and transport failures are UNAVAILABLE and never echo anything`() {
        val big = "x".repeat(256 * 1024 + 1)
        for (broken in listOf(
            channel(body = "not json"), channel(body = "[]"), channel(body = "{} {}"), channel(body = "{a:1}"),
            channel(type = "text/html"), channel(type = null), channel(encoding = "gzip"), channel(declared = 300_000),
            channel(body = big, declared = -1), channel(failure = SocketTimeoutException("carries $record")))) {
            val text = broken.handle("""{"op":"list"}""")
            assertEquals("UNAVAILABLE", reply(text)["unavailable"].asString)
            assertFalse(text.contains(record))
            assertTrue(last!!.disconnected)
        }
    }

    @Test fun `the proof never appears in a reply or a description`() {
        val channel = channel()
        for (command in listOf("""{"op":"list"}""", "bad")) assertFalse(channel.handle(command).contains(AvdSimulatorSamples.proof))
        assertFalse(channel.toString().contains(AvdSimulatorSamples.proof))
        assertEquals(URL("https://carscope-lluo.onrender.com").host, URL(AvdSimulatorPolicy.API_ORIGIN).host)
    }
}
