package io.carscope.app.sync

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
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

/** Real Node TLS/SQLite + shipped mobile JS + Native JVM. No smartphone/AVD/runtime claim. */
class NativeTireHttpsE2eTest {
    @Test fun `tire QR mobile explicit submit duplicate receipt Native receive explicit accept and mobile final proof over TLS`() {
        val root = generateSequence(File(System.getProperty("user.dir") ?: ".").canonicalFile) { it.parentFile }
            .first { File(it, "tools/native-sync-e2e/tire-fixture.mjs").isFile }
        val credential = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))
        val process = ProcessBuilder("node", File(root, "tools/native-sync-e2e/tire-fixture.mjs").path).directory(root).apply {
            environment()["SYNC_NATIVE_E2E_CREDENTIAL"] = credential
        }.start()
        val worker = Executors.newSingleThreadExecutor()
        val input = process.inputStream.bufferedReader(); val output = process.outputStream.bufferedWriter()
        fun read(): JsonObject = JsonParser.parseString(worker.submit<String> { input.readLine() ?: error("fixture stopped") }.get(15, TimeUnit.SECONDS)).asJsonObject
        fun command(op: String, qr: String? = null): JsonObject {
            val request = JsonObject().apply { addProperty("op", op); if (qr != null) addProperty("qr", qr) }
            output.write(request.toString()); output.newLine(); output.flush(); return read()
        }
        try {
            val ready = read(); val origin = ready["origin"].asString
            val certFile = File(ready["caFile"].asString)
            val cert = certFile.inputStream().use { CertificateFactory.getInstance("X.509").generateCertificate(it) }
            val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("owned-fixture-ca", cert) }
            val tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }
            val tls = SSLContext.getInstance("TLS").apply { init(null, tm.trustManagers, SecureRandom()) }
            val endpoint = SyncEndpoint(origin, origin)
            val queue = LinkedBlockingQueue<() -> Unit>()
            fun drain() { (queue.poll(15, TimeUnit.SECONDS) ?: error("Native callback missing"))() }
            // Per-test trust only. Default hostname verifier and production providers are untouched.
            fun transport(provider: SessionCreationCredentialProvider) = HttpsSyncReceiverTransport(endpoint, provider,
                SyncCallbackDispatcher { queue.put(it) }, connections = { uri ->
                    (uri.toURL().openConnection() as HttpsURLConnection).apply { sslSocketFactory = tls.socketFactory }
                })
            transport(DenyByDefaultCredentialProvider()).use { denied ->
                var reply: SyncReply<CreatedSyncSession>? = null
                denied.create("tire.front-left") { reply = it }; drain()
                assertEquals(SyncFailure.UNAUTHORIZED, (reply as SyncReply.Failure).reason)
            }
            val provider = object : SessionCreationCredentialProvider {
                override fun credential(endpoint: SyncEndpoint): SessionCreationCredential? =
                    if (endpoint.apiOrigin == origin && java.net.URI(origin).host == "127.0.0.1") SessionCreationCredential(credential) else null
            }
            transport(provider).use { http ->
                var connected: SyncReply<Unit>? = null
                http.checkConnection { connected = it }; drain(); assertTrue(connected is SyncReply.Success)
                val owner = SyncReceiverController(SyncReceiverClient(http, System::currentTimeMillis), SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
                try {
                    owner.create(origin, "tire.front-left"); drain()
                    assertEquals(ReceiverPhase.WAITING, owner.state.phase); assertFalse(owner.state.canAccept)
                    val qr = requireNotNull(owner.state.qr).value
                    assertFalse(qr.contains(credential)); assertTrue(qr.contains("#v=2&task=tire.front-left&invite="))
                    val matrix = QRCodeWriter().encode(qr, BarcodeFormat.QR_CODE, 512, 512)
                    val pixels = IntArray(512 * 512) { i -> if (matrix[i % 512, i / 512]) -0x1000000 else -1 }
                    val decoded = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(512, 512, pixels)))).text
                    assertTrue("QR bytes differ (redacted)", qr == decoded) // In-memory QR encode/decode, never optical scanning.
                    val completed = command("complete", decoded)
                    assertTrue(completed["historyCleared"].asBoolean); assertEquals(0, completed["submissions"].asInt)
                    assertEquals("NOT_SENT", completed["display"].asString)
                    owner.poll(); drain(); assertEquals(ReceiverPhase.WAITING, owner.state.phase)
                    val sent = command("send")
                    assertEquals("SENT", sent["display"].asString); assertEquals(2, sent["submissions"].asInt)
                    assertTrue(sent["duplicateReceiptMatches"].asBoolean)
                    repeat(2) { owner.poll(); drain(); assertEquals(ReceiverPhase.RESULT_SUBMITTED, owner.state.phase) }
                    val report = owner.state.result as CompletedTireInspection
                    assertEquals("tire.front-left", report.taskId)
                    assertEquals(TireResponse.NOT_FOUND, report.damage); assertEquals(TireResponse.FOUND, report.debris); assertEquals(TireResponse.UNABLE, report.wear)
                    assertEquals(sent["canonical"].asString, report.canonicalJson()); assertEquals(sent["digest"].asString, report.digest())
                    assertEquals(sent["inspectionId"].asString, report.inspectionId)
                    assertTrue(owner.state.canAccept); assertEquals("SENT", command("refresh")["display"].asString)
                    owner.accept(); owner.accept(); drain()
                    assertEquals(ReceiverPhase.ACCEPTED, owner.state.phase); assertFalse(owner.state.canAccept)
                    assertEquals(report, owner.state.result); assertEquals("ACCEPTED", command("refresh")["display"].asString)
                } finally { owner.close() }
            }
            output.write("{\"op\":\"stop\"}\n"); output.flush(); output.close()
            assertTrue("fixture teardown timed out", process.waitFor(10, TimeUnit.SECONDS))
            assertEquals("fixture failed (details redacted)", 0, process.exitValue())
            assertFalse("owned PKI and database must be removed", requireNotNull(certFile.parentFile).exists())
        } finally {
            runCatching { output.close() } // EOF lets Node close SQLite and remove its owned PKI even after an assertion failure.
            if (process.isAlive && !process.waitFor(10, TimeUnit.SECONDS)) {
                process.destroy(); if (!process.waitFor(3, TimeUnit.SECONDS)) process.destroyForcibly()
            }
            worker.shutdownNow()
        }
    }
}
