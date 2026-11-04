package io.carscope.app.sync

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.security.cert.Certificate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/** Deterministic platform-connection fixture. Never opens a socket or supplies a trust override. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class HttpsAvdSimulatorGrantExchangeTest {
    private class Connection(
        private val status: Int = 200,
        private val body: String = AvdSimulatorSamples.grant(),
        private val encoding: String? = null,
        private val failure: Boolean = false,
        private val gate: CountDownLatch? = null,
        private val exception: Exception? = null,
        private val declaredLength: Long? = null
    ) : HttpsURLConnection(URL(AvdSimulatorPolicy.API_ORIGIN + "/simulator/provision")) {
        val output = ByteArrayOutputStream()
        val disconnected = CountDownLatch(1)
        override fun getOutputStream() = output
        override fun getResponseCode(): Int {
            gate?.await(2, TimeUnit.SECONDS)
            if (failure) throw SocketTimeoutException("synthetic error must not be logged")
            exception?.let { throw it }
            return status
        }
        override fun getContentType() = "application/json; charset=utf-8"
        override fun getContentLengthLong() = declaredLength ?: body.toByteArray().size.toLong()
        override fun getHeaderField(name: String?) = if (name == "Content-Encoding") encoding else null
        override fun getInputStream() = ByteArrayInputStream(body.toByteArray())
        override fun disconnect() { disconnected.countDown() }
        override fun connect() {}
        override fun usingProxy() = false
        override fun getCipherSuite() = "fixture"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
    }

    private fun exchange(c: Connection, queue: LinkedBlockingQueue<() -> Unit>, timeout: Int = 1000) =
        HttpsAvdSimulatorGrantExchange(AvdSimulatorSamples.endpoint,
            AvdSimulatorPolicy.enrollment(AvdSimulatorSamples.enrollment().toByteArray(), AvdSimulatorSamples.endpoint, 2100),
            SyncCallbackDispatcher { queue.put(it) }, { 2100 }, timeout, connections = { uri ->
                assertEquals(AvdSimulatorPolicy.API_ORIGIN + "/simulator/provision", uri.toString())
                c
            })

    private fun assertFailureLog(c: Connection, expected: String) {
        ShadowLog.clear()
        val queue = LinkedBlockingQueue<() -> Unit>()
        exchange(c, queue).use { exchange ->
            exchange.fetch { assertNull(it) }
            requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
            val logs = ShadowLog.getLogsForTag("CarScopeAvdAuth")
            assertEquals(listOf(expected), logs.map { it.msg })
            assertTrue(logs.all { it.throwable == null })
        }
    }

    @Test fun `HTTP denials and rejected response headers log only their fixed category once`() {
        for ((status, code) in listOf(401 to "PROVISION_HTTP_UNAUTHORIZED", 403 to "PROVISION_HTTP_FORBIDDEN",
            429 to "PROVISION_HTTP_RATE_LIMITED", 302 to "PROVISION_HTTP_REJECTED", 503 to "PROVISION_HTTP_REJECTED")) {
            assertFailureLog(Connection(status = status), code)
        }
        assertFailureLog(Connection(encoding = "gzip"), "PROVISION_RESPONSE_HEADERS_REJECTED")
        assertFailureLog(Connection(declaredLength = SyncHttpDecoder.MAX_BYTES + 1L), "PROVISION_RESPONSE_HEADERS_REJECTED")
    }

    @Test fun `timeout TLS DNS and malformed JSON retain fixed diagnostics without exception details`() {
        val detail = "synthetic-sensitive-detail"
        assertFailureLog(Connection(exception = SocketTimeoutException(detail)), "PROVISION_TIMEOUT")
        assertFailureLog(Connection(exception = SSLException(detail)), "PROVISION_TLS_REJECTED")
        assertFailureLog(Connection(exception = UnknownHostException(detail)), "PROVISION_DNS_FAILURE")
        assertFailureLog(Connection(body = "{invalid-json"), "PROVISION_RESPONSE_INVALID_JSON")
        assertFailureLog(Connection(body = "{}"), "PROVISION_RESPONSE_CONTRACT_REJECTED")
        assertFailureLog(Connection(body = AvdSimulatorSamples.grant(2100)), "PROVISION_GRANT_EXPIRED")
    }

    @Test fun `verified response flows through provider to creation authorization and strict request settings`() {
        val c = Connection(); val queue = LinkedBlockingQueue<() -> Unit>()
        val source = RefreshingAvdSimulatorCredentialSource(AvdSimulatorSamples.endpoint, exchange(c, queue)) { 2100 }
        HttpsSyncReceiverTransport(AvdSimulatorSamples.endpoint, source.provider(), SyncCallbackDispatcher { it() }).use { transport ->
            assertFalse(transport.creationAuthorized())
            source.refresh()
            requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
            assertTrue(transport.creationAuthorized())
            assertEquals("POST", c.requestMethod)
            assertEquals("application/json; charset=utf-8", c.getRequestProperty("Content-Type"))
            assertFalse(c.instanceFollowRedirects)
            assertFalse(c.useCaches)
            assertEquals(1000, c.connectTimeout)
            assertEquals(1000, c.readTimeout)
            val request = SyncHttpDecoder.objectBody(c.output.toByteArray(), "application/json")
            assertEquals(setOf("apiOrigin", "audience"), request.keys)
            assertEquals(AvdSimulatorPolicy.API_ORIGIN, request["apiOrigin"])
        }
    }

    @Test fun `invalid JSON denied status expired response encoding and socket timeout all fail closed`() {
        for (c in listOf(Connection(body = "{}"), Connection(status = 401), Connection(status = 403),
            Connection(body = AvdSimulatorSamples.grant(2100)), Connection(encoding = "gzip"), Connection(failure = true))) {
            val queue = LinkedBlockingQueue<() -> Unit>()
            exchange(c, queue).use { exchange ->
                var count = 0
                exchange.fetch { count++; assertNull(it) }
                requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
                assertEquals(1, count)
            }
        }
    }

    @Test fun `deadline callback wins over late successful worker and cancellation suppresses queued result`() {
        val gate = CountDownLatch(1); val c = Connection(gate = gate)
        val queue = LinkedBlockingQueue<() -> Unit>()
        exchange(c, queue, 80).use { exchange ->
            var count = 0
            exchange.fetch { count++; assertNull(it) }
            requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
            gate.countDown()
            assertTrue(c.disconnected.await(3, TimeUnit.SECONDS))
            assertNull(queue.poll(150, TimeUnit.MILLISECONDS))
            assertEquals(1, count)
        }
        val queued = LinkedBlockingQueue<() -> Unit>()
        exchange(Connection(), queued).use { exchange ->
            var count = 0
            val call = exchange.fetch { count++ }
            val action = requireNotNull(queued.poll(3, TimeUnit.SECONDS))
            call.cancel(); action()
            assertEquals(0, count)
        }
    }
}
