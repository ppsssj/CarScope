package io.carscope.app.sync

import java.io.File
import org.junit.Assert.*
import org.junit.Test

internal object BrakeSamples {
    fun result() = CompletedChecklistInspection(HttpSamples.ID, "brake-fluid", "2026-11-03T00:00:00.000Z", "2026-11-03T00:02:00.000Z",
        mapOf("levelMarking" to ChecklistAnswer.NOT_FOUND, "leakTrace" to ChecklistAnswer.FOUND, "exteriorDamage" to ChecklistAnswer.UNABLE),
        false, true, ChecklistReportedStatus.REVIEW_NEEDED)
}
class BrakeSyncReceiverTest {
    @Test fun `actual mobile constructors and server validate all 108 brake combinations matching Native canonical bytes and digest`() {
        val root = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }.first { File(it, "settings.gradle.kts").isFile }
        val process = ProcessBuilder("node", File(root, "tools/native-brake-sync/vectors.mjs").path).directory(root).start()
        val lines = process.inputStream.bufferedReader().readLines(); val errors = process.errorStream.bufferedReader().readText()
        assertEquals(errors, 0, process.waitFor()); assertEquals(108, lines.size)
        for (line in lines) {
            val (raw, canonical, digest) = line.split('\t')
            val wire = """{"sessionId":"${HttpSamples.ID}","taskId":"brake-fluid","sessionState":"RESULT_SUBMITTED","expiresAt":2000001000000,"result":$raw,"resultDigest":"$digest","receivedAt":1,"acceptedAt":null}"""
            val result = requireNotNull(TireSamples.decode(wire).result)
            assertTrue(result is CompletedChecklistInspection)
            assertEquals(canonical, result.canonicalJson()); assertEquals(digest, result.digest())
        }
    }
    @Test fun `strict brake profile rejects altered keys statuses origin version task and sdk fields even with recomputed digest`() {
        val raw = BrakeSamples.result().canonicalJson()
        for ((before, after) in listOf(
            "\"schemaVersion\":2" to "\"schemaVersion\":1", "\"leakTrace\":\"FOUND\"" to "\"leakTrace\":true",
            "leakTrace" to "debris", ",\"levelMarking\":\"NOT_FOUND\"" to "", "\"responses\":{" to "\"responses\":{\"sdkValue\":0,",
            "REVIEW_NEEDED" to "NO_FINDINGS_REPORTED", "MOBILE" to "PLEOS", "USER_REPORTED" to "SDK",
            "brake-fluid" to "brake-fluid-reservoir", "2026-11-03T00:02:00.000Z" to "2026-11-03T00:02:00Z"
        )) {
            val altered = raw.replace(before, after)
            val obj = com.google.gson.JsonParser.parseString(altered)
            fun canonical(x: com.google.gson.JsonElement): String = if (x.isJsonObject) x.asJsonObject.keySet().sorted().joinToString(",", "{", "}") { "\"$it\":" + canonical(x.asJsonObject[it]) } else x.toString()
            val hash = "sha256:" + java.security.MessageDigest.getInstance("SHA-256").digest(canonical(obj).toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
            val wire = """{"sessionId":"${HttpSamples.ID}","taskId":"brake-fluid","sessionState":"RESULT_SUBMITTED","expiresAt":2000001000000,"result":$altered,"resultDigest":"$hash","receivedAt":1,"acceptedAt":null}"""
            try { TireSamples.decode(wire); fail("accepted mutation $before") } catch (_: SyncHttpDecoder.Invalid) { }
        }
    }
    @Test fun `response ownership is immutable and unsupported profiles cannot be invented`() {
        val answers = BrakeSamples.result().responses.toMutableMap()
        val result = CompletedChecklistInspection(HttpSamples.ID,"brake-fluid","2026-11-03T00:00:00.000Z","2026-11-03T00:02:00.000Z",answers,false,true,ChecklistReportedStatus.REVIEW_NEEDED)
        val hash = result.digest(); answers.clear(); assertEquals(hash,result.digest())
        assertFalse(CompletedChecklistInspection(HttpSamples.ID,"coolant",result.startedAt,result.completedAt,result.responses,false,true,result.status).valid())
    }
}
