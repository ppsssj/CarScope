package io.carscope.app.sync

import java.io.File
import java.security.MessageDigest
import com.google.gson.JsonElement
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

internal object ChargeSamples {
    fun result() = CompletedChargeInspection(HttpSamples.ID, "2026-11-03T00:00:00.000Z", "2026-11-03T00:02:00.000Z",
        ChargeResponses(ChargeAnswer.NOT_FOUND, ChargeAnswer.FOUND, ChargeAnswer.UNABLE), ChargeAids(false, true), ChargeReportedStatus.REVIEW_NEEDED)
}

class ChargeSyncReceiverTest {
    private fun invalid(wire: String) {
        try { TireSamples.decode(wire); fail("invalid charge result accepted") } catch (_: SyncHttpDecoder.Invalid) { }
    }
    // Re-sign semantic mutations so rejection cannot be explained merely by an outdated digest.
    private fun signed(raw: String, task: String = "ev-charge.port"): String {
        fun canonical(x: JsonElement): String = if (x.isJsonObject) x.asJsonObject.keySet().sorted().joinToString(",", "{", "}") {
            "\"$it\":" + canonical(x.asJsonObject[it])
        } else x.toString()
        val hash = "sha256:" + MessageDigest.getInstance("SHA-256").digest(canonical(JsonParser.parseString(raw)).toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        return """{"sessionId":"${HttpSamples.ID}","taskId":"$task","sessionState":"RESULT_SUBMITTED","expiresAt":2000001000000,"result":$raw,"resultDigest":"$hash","receivedAt":1,"acceptedAt":null}"""
    }
    @Test fun `all 27 charge response combinations and four aids combinations match real JS canonical bytes and SHA256`() {
        val root = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }.first { File(it, "settings.gradle.kts").isFile }
        val process = ProcessBuilder("node", File(root, "tools/native-charge-sync/vectors.mjs").path).directory(root).start()
        val lines = process.inputStream.bufferedReader().readLines(); val errors = process.errorStream.bufferedReader().readText()
        assertEquals(errors, 0, process.waitFor()); assertEquals(108, lines.size)
        for (line in lines) {
            val (raw, canonical, digest) = line.split('\t')
            val result = requireNotNull(TireSamples.decode(signed(raw)).result)
            assertTrue(result is CompletedChargeInspection)
            assertEquals(canonical, result.canonicalJson()); assertEquals(digest, result.digest())
        }
    }
    @Test fun `charge rejects missing extra mixed task fields coercions enums constants UUID times and inconsistent status even when signed`() {
        val raw = ChargeSamples.result().canonicalJson()
        for ((before, after) in listOf(
            "\"schemaVersion\":2" to "\"schemaVersion\":1", "\"schemaVersion\":2" to "\"schemaVersion\":3", "\"schemaVersion\":2" to "\"schemaVersion\":\"2\"",
            "\"flapDamage\":\"NOT_FOUND\"," to "", "\"visibleDamage\":\"UNABLE\"" to "\"visibleDamage\":null",
            "\"visibleDamage\":\"UNABLE\"" to "\"visibleDamage\":\"OK\"", "\"responses\":{" to "\"responses\":{\"damage\":\"FOUND\",",
            "flapDamage" to "damage", "visibleDamage" to "wear", "REVIEW_NEEDED" to "NO_FINDINGS_REPORTED",
            "REVIEW_NEEDED" to "UNABLE", "USER_REPORTED" to "PLEOS", "MOBILE" to "VEHICLE", "SELF" to "AUTO",
            "COMPLETED" to "IN_PROGRESS", "NOT_SENT" to "SENT", "\"aids\":{" to "\"aids\":{\"gps\":true,",
            "\"cameraUsed\":false" to "\"cameraUsed\":0", "\"cameraUsed\":false," to "",
            "2026-11-03T00:02:00.000Z" to "2026-11-03T00:02:00Z", "2026-11-03T00:02:00.000Z" to "2026-02-30T00:02:00.000Z",
            "2026-11-03T00:02:00.000Z" to "2026-11-02T00:02:00.000Z", "2026-11-03T00:02:00.000Z" to "2026-11-03T00:02:60.000Z",
            HttpSamples.ID to HttpSamples.ID.uppercase(), "ev-charge.port" to "ev-charge.flap",
            "ev-charge.port" to "tire.front-left", "\"aids\":{" to "\"sdkValue\":true,\"aids\":{"
        )) invalid(signed(raw.replace(before, after)))
        invalid(TireSamples.wire(ChargeSamples.result(), task = "tire.front-left"))
        invalid(signed(raw).replace(ChargeSamples.result().digest(), "sha256:" + "0".repeat(64)))
        for (key in listOf("responses", "flapDamage", "debris", "visibleDamage", "cameraUsed", "schemaVersion")) {
            val wire = signed(raw)
            val value = JsonParser.parseString(raw).asJsonObject.let { it[key] ?: it["responses"].asJsonObject[key] ?: it["aids"].asJsonObject[key] }
            invalid(wire.replace("\"$key\":", "\"$key\":$value,\"$key\":"))
        }
        assertFalse(TireSamples.result("ev-charge.port").valid())
    }
    private class Transport : SyncReceiverTransport {
        var selected = "washer-fluid"; var accepts = 0
        var defer = false
        var late: (() -> Unit)? = null
        var reply: SyncReply<SyncReceiverView> = SyncReply.Success(TireSamples.decode(TireSamples.wire()))
        override fun create(callback: (SyncReply<CreatedSyncSession>) -> Unit) = create("washer-fluid", callback)
        override fun create(taskId: String, callback: (SyncReply<CreatedSyncSession>) -> Unit): SyncCancellation {
            selected = taskId
            callback(SyncReply.Success(CreatedSyncSession(HttpSamples.ID, ReceiverCredential(HttpSamples.receiver), InviteCredential(HttpSamples.invite), 2000000000000, 2000001000000, taskId)))
            return SyncCancellation {}
        }
        override fun view(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
            val value = reply
            if (defer) late = { callback(value) } else callback(value)
            return SyncCancellation {}
        }
        override fun accept(id: String, receiver: ReceiverCredential, digest: String, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation { accepts++; callback(reply); return SyncCancellation {} }
        override fun cancel(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit) = view(id, receiver, callback)
    }
    @Test fun `charge client binds selected task preserves duplicate result rejects replacement and requires shown digest for accept`() {
        for (task in listOf("ev-charge.port")) {
            val t = Transport(); val client = SyncReceiverClient(t) { 1L }
            var reply: SyncReply<SyncReceiverView>? = null
            client.create("https://mobile.example/", task) { assertTrue(it is SyncReply.Success) }
            val result = ChargeSamples.result()
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result)))
            client.accept(result.digest()) { reply = it }; assertEquals(0, t.accepts)
            repeat(2) { client.view { reply = it }; assertTrue(reply is SyncReply.Success) }
            client.accept("sha256:" + "0".repeat(64)) { reply = it }; assertEquals(0, t.accepts)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result, "ACCEPTED")))
            client.accept(result.digest()) { reply = it }; assertTrue(reply is SyncReply.Success); assertEquals(1, t.accepts)
            client.accept(result.digest()) { reply = it }; assertEquals(1, t.accepts)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result.copy(aids = ChargeAids(true, true)))))
            client.view { reply = it }; assertEquals(SyncFailure.INVALID, (reply as SyncReply.Failure).reason)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(TireSamples.result("tire.rear-right"))))
            client.view { reply = it }; assertTrue(reply is SyncReply.Failure)
        }
    }
    @Test fun `charge polling retry cancel expire and late callbacks preserve lifecycle boundary`() {
        for (task in listOf("ev-charge.port")) {
            val transport = Transport(); var clock = 1L
            val client = SyncReceiverClient(transport) { clock }
            val owner = SyncReceiverController(client, SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
            owner.create("https://mobile.example/", task)
            transport.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(ChargeSamples.result())))
            owner.poll(); val shown = owner.state.result
            transport.reply = SyncReply.Failure(SyncFailure.TIMEOUT); owner.poll()
            assertEquals(shown, owner.state.result); assertTrue(owner.state.retryAvailable); assertEquals(0, transport.accepts)
            transport.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(ChargeSamples.result())))
            owner.retryPolling(); assertEquals(shown, owner.state.result)
            transport.reply = SyncReply.Success(SyncReceiverView(HttpSamples.ID, SyncSessionState.CANCELLED, 2000001000000, taskId = task))
            owner.cancel(); assertEquals(ReceiverPhase.CANCELLED, owner.state.phase); assertNull(owner.state.result)
            owner.create("https://mobile.example/", task); clock = 2000001000001
            owner.poll(); assertEquals(ReceiverPhase.EXPIRED, owner.state.phase); assertFalse(owner.state.canAccept)
            owner.close(); assertEquals(ReceiverPhase.CLOSED, owner.state.phase)
            clock = 1L
            val fresh = SyncReceiverController(client, SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
            fresh.create("https://mobile.example/", task)
            transport.defer = true
            transport.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(ChargeSamples.result())))
            fresh.poll(); val late = requireNotNull(transport.late)
            fresh.close(); late(); assertEquals(ReceiverPhase.CLOSED, fresh.state.phase); assertNull(fresh.state.result)
        }
    }
    @Test fun `accepted proof with trimmed result retains exactly the previously displayed user report`() {
        for (task in listOf("ev-charge.port")) {
            val t = Transport(); val owner = SyncReceiverController(SyncReceiverClient(t) { 1L }, SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
            owner.create("https://mobile.example/", task)
            val result = ChargeSamples.result()
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result))); owner.poll()
            t.reply = SyncReply.Success(SyncReceiverView(HttpSamples.ID, SyncSessionState.ACCEPTED, 2000001000000, resultDigest = result.digest(), taskId = task))
            owner.accept(); assertEquals(ReceiverPhase.ACCEPTED, owner.state.phase)
            assertEquals(result, owner.state.result); assertFalse(owner.state.canAccept); assertEquals(1, t.accepts)
        }
    }
    @Test fun `charge never accepts mismatched final digest or submitted state as accepted proof`() {
        val result = ChargeSamples.result()
        for (proof in listOf(
            SyncReceiverView(HttpSamples.ID, SyncSessionState.ACCEPTED, 2000001000000, resultDigest = "sha256:" + "0".repeat(64), taskId = result.taskId),
            TireSamples.decode(TireSamples.wire(result))
        )) {
            val t = Transport(); val owner = SyncReceiverController(SyncReceiverClient(t) { 1L }, SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
            owner.create("https://mobile.example/", result.taskId)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result))); owner.poll()
            t.reply = SyncReply.Success(proof); owner.accept()
            assertEquals(ReceiverPhase.FAILED, owner.state.phase); assertEquals(SyncFailure.INVALID, owner.state.failure)
            assertFalse(owner.state.canAccept); assertNull(owner.state.result)
        }
    }
    @Test fun `charge expiry during pending view discards delayed valid result and prevents accept`() {
        var clock = 1L; val t = Transport()
        val owner = SyncReceiverController(SyncReceiverClient(t) { clock }, SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
        owner.create("https://mobile.example/", "ev-charge.port")
        t.defer = true; t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(ChargeSamples.result())))
        owner.poll(); clock = 2000001000001; t.late!!()
        assertEquals(ReceiverPhase.EXPIRED, owner.state.phase); assertNull(owner.state.result)
        owner.accept(); assertEquals(0, t.accepts)
    }
}
