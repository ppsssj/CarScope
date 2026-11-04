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
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicInteger
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

    private fun exchange(c: Connection, queue: LinkedBlockingQueue<() -> Unit>, timeout: Int = 1000,
        now: () -> Long = { 2100 }, monotonic: () -> Long = System::nanoTime,
        pause: (Long) -> Unit = Thread::sleep, requests: AtomicInteger = AtomicInteger()) =
        HttpsAvdSimulatorGrantExchange(AvdSimulatorSamples.endpoint,
            AvdSimulatorPolicy.enrollment(AvdSimulatorSamples.enrollment().toByteArray(), AvdSimulatorSamples.endpoint, 2100),
            SyncCallbackDispatcher { queue.put(it) }, now, timeout, connections = { uri ->
                requests.incrementAndGet()
                assertEquals(AvdSimulatorPolicy.API_ORIGIN + "/simulator/provision", uri.toString())
                c
            }, monotonicNanos = monotonic, pause = pause)

    @Test fun `same response waits 1200ms without authorization before notBefore or another POST`() {
        ShadowLog.clear()
        val clock = AtomicLong(800); val elapsed = AtomicLong(); val requests = AtomicInteger()
        val queue = LinkedBlockingQueue<() -> Unit>()
        val c = Connection()
        exchange(c, queue, 5000, clock::get, elapsed::get, { ms ->
            assertTrue(clock.get() < 2000)
            assertTrue(queue.isEmpty())
            assertFalse(ShadowLog.getLogsForTag("CarScopeAvdAuth").any { it.msg == "PROVISION_GRANT_VERIFIED" })
            clock.addAndGet(ms); elapsed.addAndGet(TimeUnit.MILLISECONDS.toNanos(ms))
        }, requests).use { exchange ->
            val source = RefreshingAvdSimulatorCredentialSource(AvdSimulatorSamples.endpoint, exchange, clock::get)
            HttpsSyncReceiverTransport(AvdSimulatorSamples.endpoint, source.provider(), SyncCallbackDispatcher { it() }).use { transport ->
                assertFalse(transport.creationAuthorized())
                var callbacks = 0
                source.refresh { callbacks++; assertTrue(it) }
                val action = requireNotNull(queue.poll(3, TimeUnit.SECONDS))
                assertFalse(transport.creationAuthorized())
                action()
                assertEquals(2000L, clock.get())
                assertEquals(1, callbacks)
                assertTrue(transport.creationAuthorized())
                assertEquals(1, requests.get())
                assertNull(queue.poll(100, TimeUnit.MILLISECONDS))
                assertEquals(listOf("PROVISION_GRANT_VERIFIED"), ShadowLog.getLogsForTag("CarScopeAvdAuth").map { it.msg })
            }
        }
    }

    @Test fun `three second monotonic wait cap rejects even when wall clock stays frozen or jumps valid at cap`() {
        for (jump in listOf(false, true)) {
            ShadowLog.clear()
            val elapsed = AtomicLong(); val clock = AtomicLong(800); val requests = AtomicInteger()
            val queue = LinkedBlockingQueue<() -> Unit>()
            exchange(Connection(), queue, 5000, clock::get, elapsed::get, { ms ->
                val t = elapsed.addAndGet(TimeUnit.MILLISECONDS.toNanos(ms))
                if (jump && t >= TimeUnit.SECONDS.toNanos(3)) clock.set(2000)
            }, requests).use { exchange ->
                var callbacks = 0
                exchange.fetch { callbacks++; assertNull(it) }
                requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
                assertEquals(TimeUnit.SECONDS.toNanos(3), elapsed.get())
                assertEquals(1, requests.get()); assertEquals(1, callbacks)
                assertEquals(listOf("PROVISION_GRANT_NOT_YET_VALID"), ShadowLog.getLogsForTag("CarScopeAvdAuth").map { it.msg })
                assertNull(queue.poll(100, TimeUnit.MILLISECONDS))
            }
        }
    }

    @Test fun `grant that expires during wait is rejected with no additional request`() {
        ShadowLog.clear()
        val clock = AtomicLong(1999); val elapsed = AtomicLong(); val requests = AtomicInteger()
        val queue = LinkedBlockingQueue<() -> Unit>()
        exchange(Connection(body = AvdSimulatorSamples.grant(2001)), queue, 5000, clock::get, elapsed::get, { ms ->
            clock.set(2001); elapsed.addAndGet(TimeUnit.MILLISECONDS.toNanos(ms))
        }, requests).use { exchange ->
            exchange.fetch { assertNull(it) }
            requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
            assertEquals(1, requests.get())
            assertEquals(listOf("PROVISION_GRANT_EXPIRED"), ShadowLog.getLogsForTag("CarScopeAvdAuth").map { it.msg })
        }
    }

    @Test fun `wait cannot extend original five second request deadline`() {
        ShadowLog.clear()
        val elapsed = AtomicLong(); val clock = AtomicLong(800); val requests = AtomicInteger()
        val queue = LinkedBlockingQueue<() -> Unit>()
        exchange(Connection(), queue, 5000, clock::get, elapsed::get, { _ ->
            // Simulate scheduling delay past the original deadline with an otherwise valid grant.
            elapsed.set(TimeUnit.SECONDS.toNanos(5)); clock.set(2000)
        }, requests).use { exchange ->
            var callbacks = 0
            exchange.fetch { callbacks++; assertNull(it) }
            requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
            assertEquals(1, callbacks); assertEquals(1, requests.get())
            assertEquals(listOf("PROVISION_TIMEOUT"), ShadowLog.getLogsForTag("CarScopeAvdAuth").map { it.msg })
            assertNull(queue.poll(100, TimeUnit.MILLISECONDS))
        }
    }

    @Test fun `cancel close and request timeout during wait prevent late authorization and duplicate callbacks`() {
        for (end in listOf("cancel", "close", "timeout")) {
            ShadowLog.clear()
            val waiting = CountDownLatch(1); val release = CountDownLatch(1); val exited = CountDownLatch(1)
            val clock = AtomicLong(800); val requests = AtomicInteger()
            val queue = LinkedBlockingQueue<() -> Unit>(); val c = Connection()
            val exchange = exchange(c, queue, if (end == "timeout") 300 else 5000, clock::get,
                pause = {
                    waiting.countDown()
                    // Emulate a late/non-cooperative operation; completion must still be ignored.
                    try { release.await(3, TimeUnit.SECONDS) } catch (_: InterruptedException) { }
                    clock.set(2000); exited.countDown()
                }, requests = requests)
            try {
                var callbacks = 0
                val source = RefreshingAvdSimulatorCredentialSource(AvdSimulatorSamples.endpoint, exchange, clock::get)
                source.refresh { callbacks++; assertFalse(it) }
                assertTrue(waiting.await(3, TimeUnit.SECONDS))
                when (end) {
                    "cancel" -> source.invalidate()
                    "close" -> source.close()
                    else -> requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
                }
                release.countDown()
                assertTrue(exited.await(3, TimeUnit.SECONDS))
                assertTrue(c.disconnected.await(3, TimeUnit.SECONDS))
                assertNull(queue.poll(100, TimeUnit.MILLISECONDS))
                assertNull(source.snapshot())
                assertEquals(if (end == "timeout") 1 else 0, callbacks)
                assertEquals(1, requests.get())
                val logs = ShadowLog.getLogsForTag("CarScopeAvdAuth")
                assertFalse(logs.any { it.msg == "PROVISION_GRANT_VERIFIED" })
                assertTrue(logs.all { it.throwable == null && it.msg.matches(Regex("PROVISION_[A-Z_]+")) })
            } finally { release.countDown(); exchange.close() }
        }
    }

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
        val requests = AtomicInteger()
        exchange(c, queue, 80, requests = requests).use { exchange ->
            var count = 0
            exchange.fetch { count++; assertNull(it) }
            requireNotNull(queue.poll(3, TimeUnit.SECONDS))()
            gate.countDown()
            // The deadline may win before the worker opens any connection.
            // In that case no disconnect is possible or required.
            if (requests.get() > 0) assertTrue(c.disconnected.await(3, TimeUnit.SECONDS))
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
