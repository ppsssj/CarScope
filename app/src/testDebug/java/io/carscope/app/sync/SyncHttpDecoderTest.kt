package io.carscope.app.sync

import org.junit.Assert.*
import org.junit.Test

internal object HttpSamples {
    const val ID = "12345678-1234-4123-8123-123456789abc"
    val receiver = "R".repeat(43)
    val invite = "I".repeat(43)
    val result = CompletedInspection(ID, "2026-11-01T09:00:00.000Z", "2026-11-01T09:01:00.000Z", ReportedStatus.NEEDS_REFILL, false, true)
    val creation: String get() = """{"sessionId":"$ID","taskId":"washer-fluid","receiverToken":"$receiver","inviteToken":"$invite","inviteExpiresAt":2000000000000,"expiresAt":2000001000000}"""
    fun view(state: String = "RESULT_SUBMITTED", includeResult: Boolean = true): String = """{"sessionId":"$ID","taskId":"washer-fluid","sessionState":"$state","expiresAt":2000001000000,"result":${if (includeResult) result.canonicalJson() else "null"},"resultDigest":"${result.digest()}","receivedAt":1,"acceptedAt":${if (state == "ACCEPTED") "2" else "null"}}"""
    val cancelled = """{"sessionId":"$ID","sessionState":"CANCELLED"}"""
}

class SyncHttpDecoderTest {
    private fun created(s: String, type: String? = "application/json") = SyncHttpDecoder.created(s.toByteArray(), type)
    private fun view(s: String) = SyncHttpDecoder.view(s.toByteArray(), "application/json; charset=utf-8")
    private fun invalid(block: () -> Any?) {
        try { block(); fail("invalid response accepted") } catch (e: SyncHttpDecoder.Invalid) { assertEquals("INVALID_SYNC_RESPONSE", e.message); assertNull(e.cause) }
    }
    @Test fun `valid creation and exact Node golden Digest`() {
        val x = created(HttpSamples.creation, "Application/JSON; charset=UTF-8")
        assertTrue(x.receiver.valid()); assertEquals(HttpSamples.ID, x.sessionId)
        assertFalse(x.toString().contains(HttpSamples.receiver))
        assertEquals("sha256:4ab36ad950704e07554f67234a7948fbb58b6f1cb6a36971cdc13deab222f3ff", view(HttpSamples.view()).resultDigest)
        assertEquals(SyncSessionState.ACCEPTED, view(HttpSamples.view("ACCEPTED", false)).sessionState)
    }
    @Test fun `creation rejects token UUID task missing extra null and numeric strings`() {
        for (s in listOf(
            HttpSamples.creation.replace(HttpSamples.receiver, "bad"),
            HttpSamples.creation.replace(HttpSamples.ID, "------------------------------------"),
            HttpSamples.creation.replace("washer-fluid", "tires"),
            HttpSamples.creation.replace(",\"inviteExpiresAt\":2000000000000", ""),
            HttpSamples.creation.dropLast(1) + ",\"vin\":\"x\"}",
            HttpSamples.creation.replace("2000000000000", "null"),
            HttpSamples.creation.replace("2000000000000", "\"2000000000000\""),
            HttpSamples.creation.replace("2000000000000", "true"),
            HttpSamples.creation.replace(HttpSamples.invite, HttpSamples.receiver)
        )) invalid { created(s) }
    }
    @Test fun `strict syntax rejects duplicate names comments trailing data arrays nonfinite invalid UTF8 and nesting`() {
        for (s in listOf(HttpSamples.creation.dropLast(1) + ",\"taskId\":\"washer-fluid\"}", HttpSamples.creation + " {}", "/*comment*/" + HttpSamples.creation,
            "[${HttpSamples.creation}]", "{unquoted:true}", HttpSamples.creation.replace("2000000000000", "NaN"),
            "{\"a\":".repeat(10) + "null" + "}".repeat(10))) invalid { created(s) }
        invalid { SyncHttpDecoder.created(byteArrayOf(0xc3.toByte(), 0x28), "application/json") }
    }
    @Test fun `content type size and integer bounds strictly enforced`() {
        for (type in listOf(null, "text/html", "application/jsonp", "application/json; charset=latin1")) invalid { created(HttpSamples.creation, type) }
        invalid { created(" ".repeat(SyncHttpDecoder.MAX_BYTES + 1)) }
        for (number in listOf("-1", "1.1", "1e10", "9007199254740992", "9223372036854775808")) invalid { created(HttpSamples.creation.replace("2000000000000", number)) }
    }
    @Test fun `all completed record constants types timestamp ordering and aids fields validated`() {
        val input = HttpSamples.view()
        for (s in listOf(input.replace("COMPLETED", "IN_PROGRESS"), input.replace("USER_REPORTED", "VERIFIED"), input.replace("MOBILE", "VEHICLE"),
            input.replace("SELF", "SENSOR"), input.replace("NEEDS_REFILL", "GOOD"), input.replace("NOT_SENT", "SENT"),
            input.replace("\"schemaVersion\":1", "\"schemaVersion\":\"1\""), input.replace("\"cameraUsed\":false", "\"cameraUsed\":0"),
            input.replace("\"locationMarked\":true", "\"locationMarked\":true,\"gps\":0"), input.replace("2026-11-01T09:01:00.000Z", "2020-01-01T00:00:00.000Z"),
            input.replace("2026-11-01T09:01:00.000Z", "2026-11-01T09:01:00.1234Z"), input.replace("RESULT_SUBMITTED", "NEW_STATE"))) invalid { view(s) }
    }
    @Test fun `digest mismatch and impossible state field combinations rejected`() {
        for (s in listOf(HttpSamples.view().replace(HttpSamples.result.digest(), "sha256:" + "0".repeat(64)), HttpSamples.view(includeResult = false),
            HttpSamples.view("CREATED"), HttpSamples.view("CANCELLED"), HttpSamples.view("EXPIRED"), HttpSamples.view().replace("\"acceptedAt\":null", "\"acceptedAt\":2"),
            HttpSamples.view("ACCEPTED").replace("\"acceptedAt\":2", "\"acceptedAt\":null"))) invalid { view(s) }
    }
    @Test fun `cancel response is exact minimal wire form and binds expected session`() {
        val v = SyncHttpDecoder.cancelled(HttpSamples.cancelled.toByteArray(), "application/json", HttpSamples.ID, 42)
        assertEquals(SyncSessionState.CANCELLED, v.sessionState); assertEquals(42L, v.expiresAt)
        invalid { SyncHttpDecoder.cancelled(HttpSamples.cancelled.toByteArray(), "application/json", "other", 42) }
        invalid { SyncHttpDecoder.cancelled(HttpSamples.cancelled.replace("CANCELLED", "ACCEPTED").toByteArray(), "application/json", HttpSamples.ID, 42) }
    }
    @Test fun `error decoder requires status code pair and never echoes input`() {
        val cases = mapOf(401 to "UNAUTHORIZED", 403 to "FORBIDDEN", 404 to "NOT_FOUND", 409 to "CONFLICT", 410 to "SESSION_EXPIRED", 429 to "RATE_LIMITED", 500 to "INTERNAL")
        for ((status, code) in cases) assertNotNull(SyncHttpDecoder.error("""{"error":{"code":"$code"}}""".toByteArray(), "application/json", status))
        invalid { SyncHttpDecoder.error("""{"error":{"code":"${HttpSamples.receiver}"}}""".toByteArray(), "application/json", 500) }
        invalid { SyncHttpDecoder.error("""{"error":{"code":"INTERNAL","message":"secret"}}""".toByteArray(), "application/json", 500) }
        invalid { SyncHttpDecoder.error("""{"error":{"code":"INTERNAL"}}""".toByteArray(), "application/json", 401) }
    }
}
