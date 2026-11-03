package io.carscope.app.sync

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import org.junit.Assert.*
import org.junit.Test

/** Actual loopback TLS and SQLite, synthetic authority. No Android/AVD/login/issuer claim. */
class HttpsProvisioningIntegrationTest {
    @Test fun `HTTPS provisioning refresh revocation expiry and reconnection gate Native creation against remote authority`() {
        val root = generateSequence(File(System.getProperty("user.dir") ?: ".").canonicalFile) { it.parentFile }
            .first { File(it, "tools/native-auth-sync/fixture.mjs").isFile }
        val proof = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))
        val process = ProcessBuilder("node", File(root, "tools/native-auth-sync/fixture.mjs").path).directory(root).apply {
            environment()["SYNC_ENROLLMENT_FIXTURE"] = proof
        }.start()
        val worker = Executors.newSingleThreadExecutor(); val input = process.inputStream.bufferedReader(); val output = process.outputStream.bufferedWriter()
        fun read(): JsonObject = JsonParser.parseString(worker.submit<String> { input.readLine() ?: error("fixture ended") }.get(15, TimeUnit.SECONDS)).asJsonObject
        fun command(op: String) { output.write("{\"op\":\"$op\"}\n"); output.flush(); assertTrue(read()["ok"].asBoolean) }
        try {
            val ready = read(); val endpoint = SyncEndpoint(ready["apiOrigin"].asString, ready["apiOrigin"].asString)
            val issuer = ready["issuer"].asString; val audience = ready["audience"].asString
            val ca = File(ready["caFile"].asString)
            val cert = ca.inputStream().use { CertificateFactory.getInstance("X.509").generateCertificate(it) }
            val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("owned-test-ca", cert) }
            val tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }
            val tls = SSLContext.getInstance("TLS").apply { init(null, tm.trustManagers, SecureRandom()) }
            val queue = LinkedBlockingQueue<() -> Unit>(); val dispatcher = SyncCallbackDispatcher { queue.put(it) }
            fun drain() { (queue.poll(15, TimeUnit.SECONDS) ?: error("callback missing"))() }
            fun enrollment() = object : EnrollmentCredentialSource { override fun snapshot() = EnrollmentCredential(proof) }
            val exchange = HttpsProvisioningExchange(endpoint, ready["authorityOrigin"].asString, issuer, audience, enrollment(), dispatcher,
                connections = { (it.toURL().openConnection() as HttpsURLConnection).apply { sslSocketFactory = tls.socketFactory } })
            val source = RefreshingProvisionedCredentialSource(endpoint, issuer, audience, exchange)
            val transport = HttpsSyncReceiverTransport(endpoint, source.provider(), dispatcher,
                connections = { (it.toURL().openConnection() as HttpsURLConnection).apply { sslSocketFactory = tls.socketFactory } })
            val client = SyncReceiverClient(transport, System::currentTimeMillis)
            fun refresh(expected: Boolean) {
                var ok: Boolean? = null; source.refresh { ok = it }; assertFalse(transport.creationAuthorized()); drain(); assertEquals(expected, ok)
                assertEquals(expected, transport.creationAuthorized())
            }
            fun create(expected: Boolean) {
                var result: SyncReply<ReceiverSession>? = null
                client.create(endpoint.mobileRoot, "tire.front-left") { result = it }; drain()
                assertEquals(expected, result is SyncReply.Success)
                if (!expected) assertEquals(SyncFailure.UNAUTHORIZED, (result as SyncReply.Failure).reason)
            }
            transport.use {
                assertFalse(transport.creationAuthorized()); refresh(true); create(true)
                command("revoke"); create(false) // Server revocation is authoritative even before the local lease expires.
                refresh(false)
                command("rotate"); refresh(true); create(true)
                command("expire"); create(false); refresh(false)
                command("rotate"); command("outage"); refresh(false)
                command("recover"); refresh(true); create(true)
                command("redirect"); refresh(false); command("recover")
                HttpsProvisioningExchange(endpoint, ready["authorityOrigin"].asString, issuer, audience, enrollment(), dispatcher).use { untrusted ->
                    var grant: ProvisionedCreationCredential? = ProvisioningSamples.lease()
                    untrusted.fetch { grant = it }; drain(); assertNull(grant)
                }
                command("delay")
                HttpsProvisioningExchange(endpoint, ready["authorityOrigin"].asString, issuer, audience, enrollment(), dispatcher, timeoutMs = 40,
                    connections = { (it.toURL().openConnection() as HttpsURLConnection).apply { sslSocketFactory = tls.socketFactory } }).use { slow ->
                    var callbacks = 0; slow.fetch { callbacks++; assertNull(it) }; drain()
                    queue.poll(350, TimeUnit.MILLISECONDS)?.invoke(); assertEquals(1, callbacks)
                }
                source.invalidate(); assertFalse(transport.creationAuthorized())
            }
            output.write("{\"op\":\"stop\"}\n"); output.flush(); output.close()
            assertTrue(process.waitFor(10, TimeUnit.SECONDS)); assertEquals("fixture failed (redacted)", 0, process.exitValue())
            assertFalse(requireNotNull(ca.parentFile).exists())
        } finally {
            runCatching { output.close() }
            if (process.isAlive && !process.waitFor(10, TimeUnit.SECONDS)) { process.destroy(); if (!process.waitFor(3, TimeUnit.SECONDS)) process.destroyForcibly() }
            worker.shutdownNow()
        }
    }
}
