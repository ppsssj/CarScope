package io.carscope.app.sync

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val SECRET_SESSION = "SECRET-LOCAL-SESSION"

class NativeInspectionBridgeTest {
    private val gson = Gson()
    private class Fixture {
        var elapsed = 1000L
        val requests = mutableListOf<NativeInspectionRequest>()
        val bridge = NativeInspectionBridge({ elapsed }, requests::add, {})
        val clock = SyncServerClock.fromResponse(100_000, 1000, 1000)!!
        val gson = Gson()
        fun rpc(op: String, fields: Map<String, Any> = emptyMap()) = JsonParser.parseString(bridge.handle(gson.toJson(
            mapOf("op" to op, "localSessionId" to "native-contract", "generation" to 1) + fields))).asJsonObject
        init { assertTrue(rpc("open")["ok"].asBoolean) }
        fun request(task: String = "washer-fluid") = rpc("request", mapOf("taskId" to task, "partId" to NativeInspectionBridge.partId(task)!!))
        fun state(task: String = "washer-fluid", syncId: String = HttpSamples.ID, clockValue: SyncServerClock? = clock): SyncReceiverState {
            request(task)
            assertTrue(bridge.arm(requests.last()))
            val raw = NativeTaskSamples.result(task).canonicalJson().replace(HttpSamples.ID, UUID.randomUUID().toString())
            val result = SyncHttpDecoder.view(NativeTaskSamples.signed(raw, task).toByteArray(), "application/json").result!!
            val waiting = SyncReceiverState(ReceiverPhase.WAITING, expiresAt = 160_000, syncSessionId = syncId, clock = clockValue)
            bridge.state(waiting)
            return waiting.copy(phase = ReceiverPhase.ACCEPTED, result = result, digest = result.digest(),
                receivedAt = 105_000, acceptedAt = 106_000, explicitlyAccepted = true)
        }
    }
    @Test fun `server clock is optional for standalone receiver but never fabricated for bridge`() {
        val f = Fixture(); val state = f.state(clockValue = null); f.bridge.state(state)
        val poll = f.rpc("poll")
        assertEquals(0, poll["bindings"].asJsonArray.size()); assertEquals(0, poll["accepted"].asJsonArray.size())
        assertEquals("SERVER_CLOCK_UNAVAILABLE", poll["unavailable"].asString) // explicit Accept must not mask the cause
        assertNull(SyncServerClock.fromResponse(1000, 100, 99))
        assertNull(SyncServerClock.fromResponse(1000, 100, 5101))
        assertNull(f.clock.upperNow(999))
    }
    @Test fun `only explicit accepted state with matching digest and times enters vault once`() {
        val f = Fixture(); val accepted = f.state(); f.rpc("poll")
        f.bridge.state(accepted.copy(phase = ReceiverPhase.RESULT_SUBMITTED, explicitlyAccepted = false))
        assertEquals(0, f.rpc("poll")["accepted"].asJsonArray.size())
        f.bridge.state(accepted.copy(explicitlyAccepted = false))
        assertEquals(0, f.rpc("poll")["accepted"].asJsonArray.size())
        f.bridge.state(accepted)
        val first = f.rpc("poll"); f.bridge.state(accepted)
        assertEquals(first["accepted"], f.rpc("poll")["accepted"])
        assertEquals(1, first["accepted"].asJsonArray.size())
        assertFalse(first.toString().contains(HttpSamples.receiver)); assertFalse(first.toString().contains(HttpSamples.invite))
    }
    @Test fun `digest mismatch impossible times expiry and delayed binding cannot deliver`() {
        for (mutation in listOf<(SyncReceiverState) -> SyncReceiverState>(
            { it.copy(digest = "sha256:" + "0".repeat(64)) }, { it.copy(receivedAt = 101_999) },
            { it.copy(acceptedAt = 104_999) }, { it.copy(acceptedAt = 160_001) })) {
            val f = Fixture(); val state = f.state(); f.rpc("poll"); f.bridge.state(mutation(state))
            assertEquals(0, f.rpc("poll")["accepted"].asJsonArray.size())
        }
        val late = Fixture(); val state = late.state(); late.elapsed += 2001; late.bridge.state(state)
        assertEquals(0, late.rpc("poll")["accepted"].asJsonArray.size())
        val expired = Fixture(); val accepted = expired.state(); expired.rpc("poll"); expired.elapsed += 60_001
        expired.bridge.state(accepted); assertEquals(0, expired.rpc("poll")["accepted"].asJsonArray.size())
    }
    @Test fun `cancel close background recreation and stale generation revoke vault`() {
        for (phase in listOf(ReceiverPhase.CANCELLED, ReceiverPhase.EXPIRED, ReceiverPhase.FAILED, ReceiverPhase.CLOSED)) {
            val f = Fixture(); val accepted = f.state(); f.rpc("poll"); f.bridge.state(accepted.copy(phase = phase))
            f.bridge.state(accepted); assertEquals(0, f.rpc("poll")["accepted"].asJsonArray.size())
        }
        val f = Fixture(); val state = f.state(); f.rpc("poll"); f.bridge.suspend(); f.bridge.state(state)
        assertTrue(f.rpc("poll").has("error")); f.bridge.resume()
        assertTrue(f.rpc("open").has("error")) // replaying the old generation cannot reopen it
        f.bridge.destroy(); assertTrue(f.rpc("open").has("error"))
    }
    @Test fun `callback before current UI activation and old activation cannot bind a newer session`() {
        val f = Fixture(); f.request(); val old = f.requests.last()
        val waiting = SyncReceiverState(ReceiverPhase.WAITING, expiresAt = 160000, syncSessionId = HttpSamples.ID, clock = f.clock)
        f.bridge.state(waiting)
        assertEquals(0, f.rpc("poll")["bindings"].asJsonArray.size())
        f.bridge.clear()
        f.bridge.handle("""{"op":"open","localSessionId":"new","generation":2}""")
        assertFalse(f.bridge.arm(old)); assertFalse(f.bridge.isCurrent(old))
        f.bridge.state(waiting)
        val poll = f.bridge.handle("""{"op":"poll","localSessionId":"new","generation":2}""")
        assertEquals(0, JsonParser.parseString(poll).asJsonObject["bindings"].asJsonArray.size())
    }
    @Test fun `arbitrary JSON proof result and different task cannot be supplied by asset RPC`() {
        val f = Fixture()
        assertTrue(f.rpc("accepted", mapOf("result" to HttpSamples.result.canonicalJson())).has("error"))
        assertTrue(f.rpc("request", mapOf("taskId" to "washer-fluid", "partId" to "tire.front-left")).has("error"))
        val accepted = f.state(); val poll = f.rpc("poll"); f.bridge.state(accepted)
        val binding = poll["bindings"].asJsonArray[0].asJsonObject
        val fields = binding.keySet().associateWith { key ->
            if (key in listOf("generation", "serverNow", "expiresAt")) binding[key].asLong as Any else binding[key].asString as Any
        }.toMutableMap()
        fields.remove("localSessionId"); fields.remove("generation")
        fields["inspectionId"] = accepted.result!!.inspectionId; fields["resultDigest"] = accepted.digest!!
        assertTrue(f.rpc("verify", fields.mapValues { it.value!! }).has("proof"))
        for (key in listOf("bindingId", "syncSessionId", "taskId", "partId", "inspectionId", "resultDigest")) {
            assertTrue(f.rpc("verify", fields.mapValues { it.value!! } + (key to "different")).has("error"))
        }
    }
    @Test fun `same inspection ID with a different canonical result conflicts instead of replacing first proof`() {
        val f = Fixture(); val first = f.state(); f.rpc("poll"); f.bridge.state(first)
        val next = f.state(syncId = UUID.randomUUID().toString()); f.rpc("poll")
        val changed = (first.result as CompletedInspection).copy(status = ReportedStatus.OK)
        f.bridge.state(next.copy(result = changed, digest = changed.digest()))
        val poll = f.rpc("poll")
        assertEquals(1, poll["accepted"].asJsonArray.size())
        assertEquals(first.digest, poll["accepted"].asJsonArray[0].asJsonObject["resultDigest"].asString)
        assertEquals("RESULT_CONFLICT", poll["unavailable"].asString)
    }
    @Test fun `real Kotlin vault is consumed by fixed JS adapter and existing C1 consumer for all 17 tasks`() {
        val f = Fixture()
        for (task in SyncTasks.all) f.bridge.state(f.state(task, UUID.randomUUID().toString()))
        assertEquals(17, runNodeConsumer(f)["records"].asInt)
    }
    @Test fun `current server without serverNow blocks the real JS consumer instead of delivering explicit Accept`() {
        val f = Fixture(); f.bridge.state(f.state(clockValue = null))
        val done = runNodeConsumer(f, "blocked")
        assertEquals(0, done["records"].asInt); assertEquals("SERVER_CLOCK_UNAVAILABLE", done["notice"].asString)
    }
    private class DiagFixture {
        var elapsed = 1000L
        val lines = mutableListOf<String>()
        val requests = mutableListOf<NativeInspectionRequest>()
        val gson = Gson()
        val bridge = NativeInspectionBridge({ elapsed }, requests::add, {}, { elapsed += 600 }, lines::add)
        fun rpc(op: String, generation: Int = 1, session: String = SECRET_SESSION, fields: Map<String, Any> = emptyMap()) = JsonParser.parseString(bridge.handle(gson.toJson(
            mapOf("op" to op, "localSessionId" to session, "generation" to generation) + fields))).asJsonObject
        fun request(task: String, generation: Int = 1) = rpc("request", generation, fields = mapOf("taskId" to task, "partId" to NativeInspectionBridge.partId(task)!!))
        fun error(json: com.google.gson.JsonObject) = json["error"]?.asString
    }
    @Test fun `a transient suspend closes the session for good until the page opens a newer generation`() {
        val f = DiagFixture(); assertTrue(f.rpc("open").has("ok")); assertTrue(f.request("washer-fluid").has("ok"))
        f.bridge.suspend()
        assertEquals("UNAVAILABLE", f.error(f.rpc("poll")))
        assertTrue(f.lines.any { it == "suspend hadSession=true pending=true" })
        assertTrue(f.lines.last(), f.lines.last().contains("stage=INACTIVE"))
        f.bridge.resume()
        assertEquals("resume restores nothing", "REJECTED", f.error(f.rpc("poll")))
        assertTrue(f.lines.last(), f.lines.last().contains("op=poll stage=SESSION_CLEARED"))
        assertEquals("the old generation cannot reopen", "REJECTED", f.error(f.rpc("open")))
        assertTrue(f.lines.last(), f.lines.last().contains("op=open stage=GENERATION_NOT_NEWER"))
        assertEquals("no pending request survives", 1, f.requests.size)
        assertTrue(f.rpc("open", 2, "second-session").has("ok"))
        assertTrue(f.rpc("poll", 2, "second-session").has("bindings"))
        assertTrue(f.lines.any { it == "open generation=2" })
    }
    @Test fun `a reloaded page starting again at generation one is rejected and the rejection is named`() {
        val f = DiagFixture(); assertTrue(f.rpc("open").has("ok"))
        assertEquals("REJECTED", f.error(f.rpc("open", 1, "reloaded-page")))
        assertTrue(f.lines.last(), f.lines.last().contains("stage=GENERATION_NOT_NEWER"))
        assertTrue("the current owner keeps working", f.rpc("poll").has("bindings"))
    }
    @Test fun `each rejection names its stage and only a different part conflicts with a pending request`() {
        val f = DiagFixture(); assertTrue(f.rpc("open").has("ok"))
        assertEquals("REJECTED", f.error(f.rpc("poll", 1, "other-session"))); assertTrue(f.lines.last(), f.lines.last().contains("op=poll stage=SESSION_MISMATCH"))
        assertEquals("REJECTED", f.error(f.rpc("poll", 2))); assertTrue(f.lines.last(), f.lines.last().contains("op=poll stage=SESSION_MISMATCH"))
        assertEquals("REJECTED", f.error(f.rpc("nonsense"))); assertTrue(f.lines.last(), f.lines.last().contains("op=other stage=UNKNOWN_OP"))
        assertTrue(f.request("washer-fluid").has("ok"))
        assertTrue("same part reopens", f.request("washer-fluid").has("ok")); assertEquals(1, f.requests.size)
        assertEquals("REJECTED", f.error(f.request("brake-fluid"))); assertTrue(f.lines.last(), f.lines.last().contains("op=request stage=PENDING_CONFLICT"))
        assertEquals(1, f.requests.size)
        assertEquals("UNAVAILABLE", f.error(f.rpc("poll", fields = mapOf("x" to "a".repeat(4096))))); assertTrue(f.lines.last(), f.lines.last().contains("stage=OVERSIZED"))
        assertTrue("rejections do not close the session", f.rpc("poll").has("bindings"))
    }
    @Test fun `a slow handler is logged by operation and diagnostics hold no session task or body`() {
        val f = DiagFixture(); assertTrue(f.rpc("open").has("ok")); assertTrue(f.request("washer-fluid").has("ok"))
        assertTrue("the second request reopens and advances the clock", f.request("washer-fluid").has("ok"))
        assertTrue(f.lines.toString(), f.lines.any { it == "slow op=request ms=600" })
        f.rpc("poll", 1, "other-session"); f.rpc("verify", fields = mapOf("resultDigest" to "SECRET-DIGEST", "bindingId" to "SECRET-BINDING"))
        f.rpc("poll", fields = mapOf("x" to "SECRET-BODY".repeat(500))); f.bridge.suspend(); f.bridge.destroy()
        val text = f.lines.joinToString("\n")
        for (secret in listOf(SECRET_SESSION, "other-session", "washer-fluid", "SECRET-DIGEST", "SECRET-BINDING", "SECRET-BODY")) assertFalse(text, text.contains(secret))
    }
    @Test fun `asset RPC rejects a second pending task oversized bodies and unknown trust keys`() {
        val f = Fixture(); f.request()
        assertTrue(f.request("battery-12v").has("error"))
        assertTrue(f.request().has("ok")) // the same pending task only reopens the Native panel
        assertEquals(listOf("washer-fluid"), f.requests.map { it.taskId })
        assertTrue(f.rpc("poll", mapOf("trusted" to true)).has("error"))
        assertTrue(f.rpc("poll", mapOf("sessionState" to "ACCEPTED")).has("error"))
        assertTrue(f.rpc("poll", mapOf("x" to "a".repeat(4096))).has("error"))
        assertTrue(f.rpc("open").has("ok")) // the current owner is unchanged by rejected commands
    }
    private fun runNodeConsumer(f: Fixture, mode: String? = null): com.google.gson.JsonObject {
        val root = NativeTaskSamples.root()
        val stderr = File(root, "app/build/native-3d-node-stderr${mode?.let { "-$it" } ?: ""}.txt")
        val process = ProcessBuilder(listOfNotNull("node", File(root, "tools/three-poc/test/native-bridge-consumer.mjs").path, mode))
            .directory(root).redirectError(stderr).start()
        val input = process.inputStream.bufferedReader(); val output = process.outputStream.bufferedWriter()
        var done: com.google.gson.JsonObject? = null
        while (true) {
            val line = input.readLine() ?: break
            val message = JsonParser.parseString(line).asJsonObject
            if (message.has("done")) { done = message; break }
            output.write(f.bridge.handle(message["command"].asString)); output.newLine(); output.flush()
        }
        assertTrue(process.waitFor(15, TimeUnit.SECONDS))
        assertEquals(stderr.readText(), 0, process.exitValue())
        return requireNotNull(done)
    }
}
