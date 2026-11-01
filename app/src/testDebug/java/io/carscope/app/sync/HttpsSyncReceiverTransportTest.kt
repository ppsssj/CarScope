package io.carscope.app.sync

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.net.URI
import java.nio.file.Files
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import com.google.gson.JsonParser

/** Explicit fixture provider lives in testDebug only; it cannot authorize any non-loopback origin. */
internal class ExplicitDebugTestCredentialProvider(private val origin: String) : SessionCreationCredentialProvider {
    override fun credential(endpoint: SyncEndpoint): SessionCreationCredential? {
        val host = URI(endpoint.apiOrigin).host
        return if (endpoint.apiOrigin == origin && host in listOf("localhost", "127.0.0.1", "[::1]")) SessionCreationCredential("T".repeat(43)) else null
    }
}

class HttpsSyncReceiverTransportTest {
    private class Pki {
        val dir = Files.createTempDirectory("carscope-ar02b2b-tls-").toFile()
        private val openssl = System.getenv("SYNC_OPENSSL") ?: if (System.getProperty("os.name")?.startsWith("Windows") == true) "C:/Program Files/Git/usr/bin/openssl.exe" else "openssl"
        private fun run(vararg args: String) {
            val process = ProcessBuilder(listOf(openssl) + args).directory(dir).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            check(process.waitFor() == 0) { "TLS fixture generation failed: $output" }
        }
        init {
            run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=CarScope JVM fixture CA")
            run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=localhost")
            for (name in listOf("valid", "wrong", "expired")) {
                File(dir, "extensions.cnf").writeText("subjectAltName=" + (if (name == "wrong") "DNS:wrong.example" else "DNS:localhost,IP:127.0.0.1") + "\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
                if (name != "expired") run("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "$name.pem", "-days", "1", "-extfile", "extensions.cnf")
                else {
                    File(dir, "index.txt").writeText(""); File(dir, "serial").writeText("1000\n")
                    File(dir, "ca.cnf").writeText("[ca]\ndefault_ca=local\n[local]\ndatabase=index.txt\nserial=serial\nnew_certs_dir=.\ncertificate=ca.pem\nprivate_key=ca.key\ndefault_md=sha256\npolicy=subject_policy\nx509_extensions=leaf\n[subject_policy]\ncommonName=supplied\n[leaf]\n" + File(dir, "extensions.cnf").readText())
                    run("ca", "-batch", "-notext", "-config", "ca.cnf", "-in", "leaf.csr", "-out", "expired.pem", "-startdate", "200101000000Z", "-enddate", "200102000000Z")
                }
                run("pkcs12", "-export", "-in", "$name.pem", "-inkey", "leaf.key", "-out", "$name.p12", "-passout", "pass:fixture-only")
            }
        }
        fun server(name: String): SSLContext {
            val keys = KeyStore.getInstance("PKCS12"); File(dir, "$name.p12").inputStream().use { keys.load(it, "fixture-only".toCharArray()) }
            val km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(keys, "fixture-only".toCharArray())
            return SSLContext.getInstance("TLS").apply { init(km.keyManagers, null, SecureRandom()) }
        }
        fun client(): SSLContext {
            val cert = File(dir, "ca.pem").inputStream().use { CertificateFactory.getInstance("X.509").generateCertificate(it) }
            val trust = KeyStore.getInstance(KeyStore.getDefaultType()); trust.load(null); trust.setCertificateEntry("fixture-ca", cert)
            val tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); tm.init(trust)
            return SSLContext.getInstance("TLS").apply { init(null, tm.trustManagers, SecureRandom()) }
        }
    }
    companion object { private val pki by lazy { Pki() } }
    private class Fixture(name: String = "valid") : AutoCloseable {
        val hits = AtomicInteger(); val arrived = CountDownLatch(1)
        var status = 200; var body = HttpSamples.view(); var contentType = "application/json"
        var delay = 0L; var location: String? = null; var drop = false
        val headers = mutableListOf<Pair<String, String?>>()
        val callbackQueue = LinkedBlockingQueue<() -> Unit>()
        private val workers = Executors.newCachedThreadPool()
        private val server = pki.server(name).serverSocketFactory.createServerSocket(0, 50, InetAddress.getByName("127.0.0.1")) as SSLServerSocket
        val origin: String get() = "https://127.0.0.1:${server.localPort}"
        init {
            workers.execute {
                while (!server.isClosed) {
                    val socket = try { server.accept() as SSLSocket } catch (_: Exception) { break }
                    workers.execute {
                        socket.use { peer -> try {
                            peer.startHandshake()
                            val reader = peer.inputStream.bufferedReader(Charsets.UTF_8)
                            val requestLine = reader.readLine() ?: return@execute
                            val requestHeaders = mutableMapOf<String, String>()
                            while (true) {
                                val line = reader.readLine() ?: return@execute
                                if (line.isEmpty()) break
                                val split = line.indexOf(':'); if (split > 0) requestHeaders[line.substring(0, split).lowercase()] = line.substring(split + 1).trim()
                            }
                            repeat(requestHeaders["content-length"]?.toInt() ?: 0) { reader.read() }
                            hits.incrementAndGet(); synchronized(headers) { headers.add(requestLine.split(' ')[1] to requestHeaders["authorization"]) }
                            arrived.countDown()
                            if (!drop) {
                                if (delay > 0) Thread.sleep(delay)
                                val bytes = body.toByteArray()
                                val response = "HTTP/1.1 $status Fixture\r\nContent-Type: $contentType\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n" +
                                    (location?.let { "Location: $it\r\n" } ?: "") + "\r\n"
                                peer.outputStream.write(response.toByteArray()); peer.outputStream.write(bytes); peer.outputStream.flush()
                            }
                        } catch (_: Exception) {} }
                    }
                }
            }
        }
        fun transport(trusted: Boolean = true, provider: SessionCreationCredentialProvider = DenyByDefaultCredentialProvider(), timeout: Int = 2000) = HttpsSyncReceiverTransport(
            SyncEndpoint(origin, "https://mobile.example/"), provider, SyncCallbackDispatcher { callbackQueue.put(it) }, 2000, timeout,
            { uri -> (uri.toURL().openConnection() as HttpsURLConnection).apply { if (trusted) sslSocketFactory = pki.client().socketFactory } })
        fun <T> await(start: ((SyncReply<T>) -> Unit) -> SyncCancellation): SyncReply<T> {
            var result: SyncReply<T>? = null
            val callingThread = Thread.currentThread()
            start { assertSame(callingThread, Thread.currentThread()); result = it }
            val action = callbackQueue.poll(10, TimeUnit.SECONDS) ?: error("missing dispatched callback")
            action(); return result ?: error("callback missing")
        }
        override fun close() { server.close(); workers.shutdownNow() }
    }
    private fun reason(r: SyncReply<*>): SyncFailure = (r as SyncReply.Failure).reason

    @Test fun `fixture TLS chain passes the unmodified JDK hostname verifier`() {
        Fixture().use { f ->
            val c = URI(f.origin).toURL().openConnection() as HttpsURLConnection
            c.sslSocketFactory = pki.client().socketFactory
            try { assertEquals(200, c.responseCode); c.inputStream.use { it.readBytes() } } finally { c.disconnect() }
        }
    }

    @Test fun `trusted TLS actual create view accept cancel and authorization headers`() {
        Fixture().use { f -> f.transport(provider = ExplicitDebugTestCredentialProvider(f.origin)).use { transport ->
            f.status = 201; f.body = HttpSamples.creation
            assertTrue(f.await(transport::create) is SyncReply.Success)
            f.status = 200; f.body = HttpSamples.view()
            assertTrue(f.await<SyncReceiverView> { transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) } is SyncReply.Success)
            f.body = HttpSamples.view("ACCEPTED")
            assertTrue(f.await<SyncReceiverView> { transport.accept(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), HttpSamples.result.digest(), it) } is SyncReply.Success)
            f.body = HttpSamples.cancelled
            assertEquals(SyncSessionState.CANCELLED, (f.await<SyncReceiverView> { transport.cancel(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) } as SyncReply.Success).value.sessionState)
            assertEquals("Bearer " + "T".repeat(43), f.headers.first().second)
            assertTrue(f.headers.all { !it.first.contains(HttpSamples.receiver) && !it.first.contains('?') })
        } }
    }
    @Test fun `creation defaults to denial before any network call and fixture provider cannot use public API`() {
        Fixture().use { f -> f.transport().use { transport ->
            assertEquals(SyncFailure.UNAUTHORIZED, reason(f.await(transport::create))); assertEquals(0, f.hits.get()); assertFalse(transport.creationAuthorized())
            assertEquals(SyncFailure.INVALID, reason(f.await<SyncReceiverView> { transport.view("bad-id", ReceiverCredential(HttpSamples.receiver), it) }))
            assertEquals(SyncFailure.INVALID, reason(f.await<SyncReceiverView> { transport.accept(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), "bad-digest", it) }))
            assertEquals(0, f.hits.get())
        } }
        assertNull(ExplicitDebugTestCredentialProvider("https://public.example").credential(SyncEndpoint("https://public.example", "https://mobile.example")))
        for (url in listOf("http://localhost", "https://user:password@localhost", "https://localhost/?token=x", "https://localhost/path", "https://localhost/#invite=x")) {
            try { SyncEndpoint(url, "https://mobile.example"); fail("unsafe endpoint") } catch (_: Exception) {}
        }
    }
    @Test fun `real TLS rejects untrusted CA wrong hostname and expired certificate`() {
        for (name in listOf("valid", "wrong", "expired")) Fixture(name).use { f -> f.transport(trusted = name != "valid").use { transport ->
            assertEquals(SyncFailure.NETWORK, reason(f.await<SyncReceiverView> { transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) }))
            assertEquals(0, f.hits.get())
        } }
    }
    @Test fun `redirects including HTTPS to HTTP never followed`() {
        for (status in listOf(301, 302, 303, 307, 308)) for (scheme in listOf("https", "http")) Fixture().use { f -> f.transport().use { transport ->
            f.status = status; f.location = "$scheme://127.0.0.1:1/credential-target"
            assertEquals(SyncFailure.INVALID, reason(f.await<SyncReceiverView> { transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) })); assertEquals(1, f.hits.get())
        } }
    }
    @Test fun `HTTP errors normalize exact codes with secret-free values`() {
        val cases = mapOf(401 to ("UNAUTHORIZED" to SyncFailure.UNAUTHORIZED), 403 to ("FORBIDDEN" to SyncFailure.UNAUTHORIZED), 404 to ("NOT_FOUND" to SyncFailure.UNAUTHORIZED),
            409 to ("CONFLICT" to SyncFailure.CONFLICT), 410 to ("SESSION_EXPIRED" to SyncFailure.EXPIRED), 429 to ("RATE_LIMITED" to SyncFailure.RATE_LIMITED), 500 to ("INTERNAL" to SyncFailure.SERVER))
        Fixture().use { f -> f.transport().use { transport -> for ((status, data) in cases) {
            f.status = status; f.body = """{"error":{"code":"${data.first}"}}"""
            val r = f.await<SyncReceiverView> { transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) }
            assertEquals(data.second, reason(r)); assertFalse(r.toString().contains(HttpSamples.receiver))
        } } }
    }
    @Test fun `timeout cancellation close and disconnected socket never call stale owner`() {
        Fixture().use { f -> f.transport(timeout = 80).use { transport ->
            f.delay = 300
            assertEquals(SyncFailure.TIMEOUT, reason(f.await<SyncReceiverView> { transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) }))
        } }
        Fixture().use { f -> f.transport().use { transport ->
            f.delay = 500; var callbacks = 0
            val call = transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver)) { callbacks++ }
            assertTrue(f.arrived.await(5, TimeUnit.SECONDS)); call.cancel(); transport.close()
            f.callbackQueue.poll(2, TimeUnit.SECONDS)?.invoke(); assertEquals(0, callbacks)
        } }
        Fixture().use { f -> f.transport().use { transport -> f.drop = true
            assertEquals(SyncFailure.NETWORK, reason(f.await<SyncReceiverView> { transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) }))
        } }
    }
    @Test fun `bad content type large body invalid JSON and Digest mismatch fail instead of successful HTTP`() {
        Fixture().use { f -> f.transport().use { transport ->
            for ((type, body) in listOf("text/html" to "<html>login</html>", "application/json" to " ".repeat(17000), "application/json" to "not json", "application/json" to HttpSamples.view().replace(HttpSamples.result.digest(), "sha256:" + "0".repeat(64)))) {
                f.contentType = type; f.body = body
                assertEquals(SyncFailure.INVALID, reason(f.await<SyncReceiverView> { transport.view(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), it) }))
            }
        } }
    }
    @Test fun `connection probe proves TLS and expected API error but never grants creation`() {
        Fixture().use { f -> f.transport().use { transport ->
            f.status = 401; f.body = """{"error":{"code":"UNAUTHORIZED"}}"""
            assertTrue(f.await(transport::checkConnection) is SyncReply.Success)
            assertFalse(transport.creationAuthorized()); assertNull(f.headers.single().second)
        } }
    }
    @Test fun `actual Node HTTPS API pairs phone result and Kotlin receiver accepts exact Digest`() {
        var root = File(System.getProperty("user.dir") ?: ".").canonicalFile
        while (!File(root, "tools/inspection-sync-poc/android/https-fixture.mjs").isFile) root = root.parentFile ?: error("repository missing")
        val process = ProcessBuilder("node", File(root, "tools/inspection-sync-poc/android/https-fixture.mjs").path,
            File(pki.dir, "valid.pem").path, File(pki.dir, "leaf.key").path).apply { environment()["SYNC_FIXTURE_TOKEN"] = "T".repeat(43) }.start()
        try {
            val line = process.inputStream.bufferedReader().readLine() ?: error("Node HTTPS fixture failed to start")
            val origin = JsonParser.parseString(line).asJsonObject["origin"].asString
            val queue = LinkedBlockingQueue<() -> Unit>()
            val transport = HttpsSyncReceiverTransport(SyncEndpoint(origin, "https://mobile.example"), ExplicitDebugTestCredentialProvider(origin),
                SyncCallbackDispatcher { queue.put(it) }, connections = { uri -> (uri.toURL().openConnection() as HttpsURLConnection).apply { sslSocketFactory = pki.client().socketFactory } })
            fun <T> await(start: ((SyncReply<T>) -> Unit) -> SyncCancellation): T {
                var value: SyncReply<T>? = null; start { value = it }; (queue.poll(10, TimeUnit.SECONDS) ?: error("no callback"))()
                assertTrue(value is SyncReply.Success); return (value as SyncReply.Success).value
            }
            fun phone(path: String, token: String, body: String?): String {
                val c = URI(origin + path).toURL().openConnection() as HttpsURLConnection
                c.sslSocketFactory = pki.client().socketFactory; c.instanceFollowRedirects = false; c.requestMethod = "POST"
                c.setRequestProperty("Authorization", "Bearer $token")
                if (body != null) { c.doOutput = true; c.setRequestProperty("Content-Type", "application/json"); c.outputStream.use { it.write(body.toByteArray()) } }
                return try { assertTrue(c.responseCode in 200..299); c.inputStream.bufferedReader().use { it.readText() } } finally { c.disconnect() }
            }
            transport.use {
                val created = await(transport::create)
                val claim = JsonParser.parseString(phone("/v1/claim", created.invite.fragment().substringAfter("invite="), null)).asJsonObject
                phone("/v1/submissions", claim["submitToken"].asString, "{\"protocol\":\"inspection-sync\",\"protocolVersion\":1,\"result\":${HttpSamples.result.canonicalJson()}}")
                val submitted = await<SyncReceiverView> { cb -> transport.view(created.sessionId, created.receiver, cb) }
                assertEquals(HttpSamples.result.digest(), submitted.resultDigest)
                val accepted = await<SyncReceiverView> { cb -> transport.accept(created.sessionId, created.receiver, submitted.resultDigest!!, cb) }
                assertEquals(SyncSessionState.ACCEPTED, accepted.sessionState)
                val second = await(transport::create)
                val cancelled = await<SyncReceiverView> { cb -> transport.cancel(second.sessionId, second.receiver, cb) }
                assertEquals(SyncSessionState.CANCELLED, cancelled.sessionState)
            }
        } finally { process.destroy(); if (!process.waitFor(3, TimeUnit.SECONDS)) process.destroyForcibly() }
    }
}
