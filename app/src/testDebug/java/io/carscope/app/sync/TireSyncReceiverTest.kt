package io.carscope.app.sync

import java.io.File
import org.junit.Assert.*
import org.junit.Test

internal object TireSamples {
    fun result(task: String = "tire.front-left") = CompletedTireInspection(HttpSamples.ID, task,
        "2026-11-03T00:00:00.000Z", "2026-11-03T00:02:00.000Z", TireResponse.NOT_FOUND,
        TireResponse.FOUND, TireResponse.UNABLE, TireReportedStatus.REVIEW_NEEDED, false, true)
    fun wire(result: SyncInspection = result(), state: String = "RESULT_SUBMITTED", task: String = result.taskId) =
        """{"sessionId":"${HttpSamples.ID}","taskId":"$task","sessionState":"$state","expiresAt":2000001000000,"result":${result.canonicalJson()},"resultDigest":"${result.digest()}","receivedAt":1,"acceptedAt":${if (state == "ACCEPTED") "2" else "null"}}"""
    fun decode(wire: String) = SyncHttpDecoder.view(wire.toByteArray(), "application/json")
}

class TireSyncReceiverTest {
    private fun invalid(wire: String) {
        try { TireSamples.decode(wire); fail("invalid tire accepted") } catch (_: SyncHttpDecoder.Invalid) { }
    }
    @Test fun `actual JS validators canonical JSON and SHA256 match Kotlin for every response combination and task`() {
        val root = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }.first { File(it, "settings.gradle.kts").isFile }
        val process = ProcessBuilder("node", File(root, "tools/native-tire-sync/vectors.mjs").path).directory(root).start()
        val lines = process.inputStream.bufferedReader().readLines()
        val errors = process.errorStream.bufferedReader().readText()
        assertEquals(errors, 0, process.waitFor()); assertEquals(109, lines.size)
        for (line in lines) {
            val (raw, canonical, digest) = line.split('\t')
            val task = if (raw.contains("washer-fluid")) "washer-fluid" else Regex("\"taskId\":\"([^\"]+)\"").find(raw)!!.groupValues[1]
            val wire = """{"sessionId":"${HttpSamples.ID}","taskId":"$task","sessionState":"RESULT_SUBMITTED","expiresAt":2000001000000,"result":$raw,"resultDigest":"$digest","receivedAt":1,"acceptedAt":null}"""
            val result = requireNotNull(TireSamples.decode(wire).result)
            assertEquals(canonical, result.canonicalJson()); assertEquals(digest, result.digest())
        }
    }
    @Test fun `four tire creations and QR bind exact tasks while unknown tasks fail`() {
        for (task in SyncTasks.all) {
            val created = SyncHttpDecoder.created(HttpSamples.creation.replace("washer-fluid", task).toByteArray(), "application/json")
            assertEquals(task, created.taskId)
            assertEquals("#v=2&task=$task&invite=${HttpSamples.invite}", created.invite.fragment(task))
        }
        try { SyncHttpDecoder.created(HttpSamples.creation.replace("washer-fluid", "tire").toByteArray(), "application/json"); fail() } catch (_: SyncHttpDecoder.Invalid) { }
    }
    @Test fun `strict nested fields enums versions status source time and task cannot be forged`() {
        val wire = TireSamples.wire()
        for ((before, after) in listOf(
            "\"schemaVersion\":2" to "\"schemaVersion\":1", "\"schemaVersion\":2" to "\"schemaVersion\":\"2\"",
            "\"damage\":\"NOT_FOUND\"," to "", "\"wear\":\"UNABLE\"" to "\"wear\":null",
            "\"wear\":\"UNABLE\"" to "\"wear\":\"OK\"", "\"responses\":{" to "\"responses\":{\"psi\":32,",
            "\"responses\":{" to "\"responses\":{\"damage\":\"FOUND\",",
            "REVIEW_NEEDED" to "NO_FINDINGS_REPORTED", "USER_REPORTED" to "PLEOS", "MOBILE" to "VEHICLE",
            "COMPLETED" to "IN_PROGRESS", "NOT_SENT" to "SENT", "\"cameraUsed\":false" to "\"cameraUsed\":0",
            "2026-11-03T00:02:00.000Z" to "2026-11-03T00:02:00Z",
            "2026-11-03T00:02:00.000Z" to "2026-02-30T00:02:00.000Z",
            "2026-11-03T00:02:00.000Z" to "2026-11-02T00:02:00.000Z",
            "2026-11-03T00:02:00.000Z" to "2026-11-03T00:02:60.000Z",
            "tire.front-left" to "ev-charge.port"
        )) invalid(wire.replace(before, after))
        invalid(TireSamples.wire(task = "tire.front-right"))
        invalid(wire.replace(TireSamples.result().digest(), "sha256:" + "0".repeat(64)))
        // Even a matching digest cannot legitimize a derived status that disagrees with the answers.
        val bad = wire.replace("REVIEW_NEEDED", "UNABLE")
        invalid(bad)
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
    @Test fun `client binds selected task preserves duplicate result rejects replacement and requires shown digest for accept`() {
        for (task in SyncTasks.tires) {
            val t = Transport(); val client = SyncReceiverClient(t) { 1L }
            var reply: SyncReply<SyncReceiverView>? = null
            client.create("https://mobile.example/", task) { assertTrue(it is SyncReply.Success) }
            val result = TireSamples.result(task)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result)))
            client.accept(result.digest()) { reply = it }; assertEquals(0, t.accepts)
            repeat(2) { client.view { reply = it }; assertTrue(reply is SyncReply.Success) }
            client.accept("sha256:" + "0".repeat(64)) { reply = it }; assertEquals(0, t.accepts)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result, "ACCEPTED")))
            client.accept(result.digest()) { reply = it }; assertTrue(reply is SyncReply.Success); assertEquals(1, t.accepts)
            client.accept(result.digest()) { reply = it }; assertEquals(1, t.accepts)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result.copy(cameraUsed = true))))
            client.view { reply = it }; assertEquals(SyncFailure.INVALID, (reply as SyncReply.Failure).reason)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(TireSamples.result("tire.rear-right".takeIf { it != task } ?: "tire.front-left"))))
            client.view { reply = it }; assertTrue(reply is SyncReply.Failure)
        }
    }
    @Test fun `tire polling retry cancel expire and late callbacks preserve lifecycle boundary`() {
        for (task in SyncTasks.tires) {
            val transport = Transport(); var clock = 1L
            val client = SyncReceiverClient(transport) { clock }
            val owner = SyncReceiverController(client, SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
            owner.create("https://mobile.example/", task)
            transport.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(TireSamples.result(task))))
            owner.poll(); val shown = owner.state.result
            transport.reply = SyncReply.Failure(SyncFailure.TIMEOUT); owner.poll()
            assertEquals(shown, owner.state.result); assertTrue(owner.state.retryAvailable); assertEquals(0, transport.accepts)
            transport.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(TireSamples.result(task))))
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
            transport.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(TireSamples.result(task))))
            fresh.poll(); val late = requireNotNull(transport.late)
            fresh.close(); late(); assertEquals(ReceiverPhase.CLOSED, fresh.state.phase); assertNull(fresh.state.result)
        }
    }
    @Test fun `accepted proof with trimmed result retains exactly the previously displayed user report`() {
        for (task in SyncTasks.tires) {
            val t = Transport(); val owner = SyncReceiverController(SyncReceiverClient(t) { 1L }, SyncReceiverScheduler { _, _ -> SyncCancellation {} }) {}
            owner.create("https://mobile.example/", task)
            val result = TireSamples.result(task)
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result))); owner.poll()
            t.reply = SyncReply.Success(TireSamples.decode(TireSamples.wire(result, "ACCEPTED")).copy(result = null))
            owner.accept(); assertEquals(ReceiverPhase.ACCEPTED, owner.state.phase)
            assertEquals(result, owner.state.result); assertFalse(owner.state.canAccept); assertEquals(1, t.accepts)
            assertEquals(1L, owner.state.receivedAt); assertEquals(2L, owner.state.acceptedAt); assertTrue(owner.state.explicitlyAccepted)
        }
    }
}
