package io.carscope.app.sync

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonElement
import com.google.gson.JsonParser
import java.io.File
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

internal object NativeTaskSamples {
    fun result(task: String): SyncInspection = when (task) {
        "washer-fluid" -> HttpSamples.result
        "ev-charge.port" -> ChargeSamples.result()
        in SyncTasks.tires -> TireSamples.result(task)
        else -> {
            val profile = SyncChecklistTasks.profiles.getValue(task)
            val answers = listOf(ChecklistAnswer.NOT_FOUND, ChecklistAnswer.FOUND, ChecklistAnswer.UNABLE)
            CompletedChecklistInspection(HttpSamples.ID,task,"2026-11-03T00:00:00.000Z","2026-11-03T00:02:00.000Z",
                profile.responseKeys.mapIndexed { i,key -> key to answers[i] }.toMap(),false,true,ChecklistReportedStatus.REVIEW_NEEDED)
        }
    }
    fun signed(raw: String, task: String): String {
        fun canonical(x: JsonElement): String = if (x.isJsonObject) x.asJsonObject.keySet().sorted().joinToString(",", "{", "}") { "\"$it\":" + canonical(x.asJsonObject[it]) } else x.toString()
        val hash = "sha256:" + MessageDigest.getInstance("SHA-256").digest(canonical(JsonParser.parseString(raw)).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
        return """{"sessionId":"${HttpSamples.ID}","taskId":"$task","sessionState":"RESULT_SUBMITTED","expiresAt":2000001000000,"result":$raw,"resultDigest":"$hash","receivedAt":1,"acceptedAt":null}"""
    }
    fun root(): File = generateSequence(File(System.getProperty("user.dir") ?: ".").canonicalFile) { it.parentFile }.first { File(it,"settings.gradle.kts").isFile }
    fun node(script: String): List<String> {
        val root = root(); val process = ProcessBuilder("node",File(root,script).path).directory(root).start()
        val lines = process.inputStream.bufferedReader().readLines(); val errors = process.errorStream.bufferedReader().readText()
        assertEquals(errors,0,process.waitFor()); return lines
    }
}

class NativeTaskCoverageTest {
    private fun invalid(wire: String) { try { TireSamples.decode(wire); fail("invalid task result accepted") } catch (_: SyncHttpDecoder.Invalid) {} }
    @Test fun `compiled Native allowlist matches mobile Node and P7-B exact task part schema and response keys`() {
        val native = JsonArray()
        for (task in SyncTasks.all) native.add(JsonObject().apply {
            addProperty("taskId",task)
            addProperty("partId",SyncChecklistTasks.profiles[task]?.partId ?: if(task=="washer-fluid") "washer-fluid-cap" else task)
            addProperty("schemaVersion",if(task=="washer-fluid") 1 else 2)
            val keys = when(task) { "washer-fluid" -> emptySet(); "ev-charge.port" -> setOf("flapDamage","debris","visibleDamage"); in SyncTasks.tires -> setOf("damage","debris","wear"); else -> SyncChecklistTasks.profiles.getValue(task).responseKeys }
            add("responseKeys",JsonArray().apply { keys.sorted().forEach { add(it) } })
        })
        assertEquals(17,SyncTasks.all.size)
        assertEquals(JsonParser.parseString(NativeTaskSamples.node("tools/native-task-sync/contract.mjs").single()),native)
        File(NativeTaskSamples.root(),"app/build/test-results/native-tasks-v2.json").apply { requireNotNull(parentFile).mkdirs(); writeText(native.toString(),Charsets.UTF_8) }
    }
    @Test fun `all 1740 mobile response aid vectors pass strict Native decoding canonical bytes and digest`() {
        val lines = NativeTaskSamples.node("tools/native-task-sync/vectors.mjs")
        assertEquals(1740,lines.size)
        val counts = mutableMapOf<String,Int>()
        for (line in lines) {
            val (raw,canonical,digest) = line.split('\t')
            val task = JsonParser.parseString(raw).asJsonObject["taskId"].asString
            val result = TireSamples.decode(NativeTaskSamples.signed(raw,task)).result!!
            assertEquals(canonical,result.canonicalJson()); assertEquals(digest,result.digest())
            counts[task] = (counts[task] ?: 0)+1
        }
        assertEquals(SyncTasks.all.toSet(),counts.keys)
        counts.forEach { (task,count) -> assertEquals(if(task=="washer-fluid")12 else 108,count) }
    }
    @Test fun `every task rejects wrong schema task binding digest constants time and extra fields even when resigned`() {
        for(task in SyncTasks.all) {
            val result = NativeTaskSamples.result(task); val raw=result.canonicalJson()
            val schema=if(task=="washer-fluid")1 else 2
            for ((before,after) in listOf(
                "\"schemaVersion\":$schema" to "\"schemaVersion\":${3-schema}",
                "\"schemaVersion\":$schema" to "\"schemaVersion\":\"$schema\"",
                "\"source\":\"MOBILE\"" to "\"source\":\"PLEOS\"", "USER_REPORTED" to "SDK",
                "\"aids\":{" to "\"aids\":{\"gps\":[0,0],", "\"cameraUsed\":false" to "\"cameraUsed\":0",
                "\"aids\":{" to "\"partId\":\"$task\",\"aids\":{",
                "\"method\":\"SELF\"" to "\"method\":\"AUTO\"", "\"sync\":\"NOT_SENT\"" to "\"sync\":\"SENT\"",
                "\"inspectionId\":\"${result.inspectionId}\"" to "\"inspectionId\":\"invalid\"",
                "\"completedAt\":\"${result.completedAt}\"" to "\"completedAt\":\"2026-02-30T00:00:00.000Z\"",
                "\"completedAt\":\"${result.completedAt}\"" to "\"completedAt\":\"2020-01-01T00:00:00.000Z\""
            )) {
                assertTrue("mutation applied: $task $before",raw.contains(before))
                invalid(NativeTaskSamples.signed(raw.replace(before,after),task))
            }
            val other=SyncTasks.all.first { it!=task }
            invalid(NativeTaskSamples.signed(raw,other))
            // Identical answer schemas never authorize LCW/general, left/right or low/high substitutions.
            val profile=SyncChecklistTasks.profiles[task]
            if(profile!=null) for ((candidate,spec) in SyncChecklistTasks.profiles) {
                if(candidate!=task && spec.responseKeys==profile.responseKeys) invalid(NativeTaskSamples.signed(raw,candidate))
            }
            invalid(TireSamples.wire(result).replace(result.digest(),"sha256:"+"0".repeat(64)))
            invalid(NativeTaskSamples.signed(raw.replace("\"source\":\"MOBILE\"","\"source\":\"MOBILE\",\"source\":\"MOBILE\""),task))
            if(task!="washer-fluid") {
                val objectResult=JsonParser.parseString(raw).asJsonObject
                for(key in objectResult["responses"].asJsonObject.keySet().toList()) {
                    for(value in listOf("UNKNOWN","OK")) {
                        val bad=objectResult.deepCopy(); bad["responses"].asJsonObject.addProperty(key,value)
                        invalid(NativeTaskSamples.signed(bad.toString(),task))
                    }
                    val bad=objectResult.deepCopy(); bad["responses"].asJsonObject.remove(key)
                    invalid(NativeTaskSamples.signed(bad.toString(),task))
                }
                val bad=objectResult.deepCopy(); bad["responses"].asJsonObject.addProperty("sdkValue",42)
                invalid(NativeTaskSamples.signed(bad.toString(),task))
            }
        }
    }
    private class Transport : SyncReceiverTransport {
        var task="washer-fluid"; var accepts=0; var views=0
        var defer=false; var late:(()->Unit)?=null
        var reply: SyncReply<SyncReceiverView> = SyncReply.Failure(SyncFailure.NETWORK)
        override fun create(callback:(SyncReply<CreatedSyncSession>)->Unit)=create("washer-fluid",callback)
        override fun create(taskId:String,callback:(SyncReply<CreatedSyncSession>)->Unit):SyncCancellation {
            task=taskId; callback(SyncReply.Success(CreatedSyncSession(HttpSamples.ID,ReceiverCredential(HttpSamples.receiver),InviteCredential(HttpSamples.invite),2000000000000,2000001000000,task)))
            return SyncCancellation {}
        }
        override fun view(id:String,receiver:ReceiverCredential,callback:(SyncReply<SyncReceiverView>)->Unit):SyncCancellation { views++; val value=reply; if(defer)late={callback(value)} else callback(value);return SyncCancellation {} }
        override fun accept(id:String,receiver:ReceiverCredential,digest:String,callback:(SyncReply<SyncReceiverView>)->Unit):SyncCancellation { accepts++;callback(reply);return SyncCancellation {} }
        override fun cancel(id:String,receiver:ReceiverCredential,callback:(SyncReply<SyncReceiverView>)->Unit):SyncCancellation { callback(SyncReply.Success(SyncReceiverView(id,SyncSessionState.CANCELLED,2000001000000,taskId=task)));return SyncCancellation {} }
    }
    private fun owner(t:Transport, clock:()->Long={1L})=SyncReceiverController(SyncReceiverClient(t,clock),SyncReceiverScheduler { _,_->SyncCancellation {} }) {}
    @Test fun `each task duplicate reports remain stable and only one explicit Accept consumes the shown digest`() {
        for(task in SyncTasks.all) {
            val t=Transport(); val owner=owner(t); owner.create("https://mobile.example/",task)
            val result=NativeTaskSamples.result(task)
            owner.accept();assertEquals(0,t.accepts)
            t.reply=SyncReply.Success(TireSamples.decode(TireSamples.wire(result)))
            repeat(2){owner.poll();assertEquals(ReceiverPhase.RESULT_SUBMITTED,owner.state.phase);assertEquals(result.digest(),owner.state.digest)}
            assertEquals(0,t.accepts)
            t.reply=SyncReply.Success(TireSamples.decode(TireSamples.wire(result,"ACCEPTED")))
            owner.accept();owner.accept();assertEquals(1,t.accepts);assertEquals(ReceiverPhase.ACCEPTED,owner.state.phase)
        }
    }
    @Test fun `every task rejects changed result digest wrong task and mismatched final acceptance proof`() {
        for(task in SyncTasks.all) for(kind in listOf("changed","task","digest","not-accepted")) {
            val t=Transport();val owner=owner(t);owner.create("https://mobile.example/",task)
            val result=NativeTaskSamples.result(task);t.reply=SyncReply.Success(TireSamples.decode(TireSamples.wire(result)));owner.poll()
            t.reply=SyncReply.Success(when(kind) {
                "changed" -> TireSamples.decode(NativeTaskSamples.signed(result.canonicalJson().replace("\"cameraUsed\":false","\"cameraUsed\":true"),task))
                "task" -> TireSamples.decode(TireSamples.wire(NativeTaskSamples.result(SyncTasks.all.first{it!=task})))
                "digest" -> SyncReceiverView(HttpSamples.ID,SyncSessionState.ACCEPTED,2000001000000,resultDigest="sha256:"+"0".repeat(64),taskId=task)
                else -> TireSamples.decode(TireSamples.wire(result))
            })
            if(kind in listOf("changed","task"))owner.poll() else owner.accept()
            assertEquals(ReceiverPhase.FAILED,owner.state.phase);assertEquals(SyncFailure.INVALID,owner.state.failure);assertFalse(owner.state.canAccept)
        }
    }
    @Test fun `every task cancellation expiry pending expiry and late callback preserve lifecycle and forbid Accept`() {
        for(task in SyncTasks.all) for(kind in listOf("cancel","expire","pending-expire","close")) {
            var now=1L;val t=Transport();val owner=owner(t){now};owner.create("https://mobile.example/",task)
            val result=NativeTaskSamples.result(task);t.reply=SyncReply.Success(TireSamples.decode(TireSamples.wire(result)))
            if(kind=="cancel"){owner.poll();owner.cancel();assertEquals(ReceiverPhase.CANCELLED,owner.state.phase)}
            if(kind=="expire"){now=2000001000001;owner.poll();assertEquals(ReceiverPhase.EXPIRED,owner.state.phase);assertEquals(0,t.views)}
            if(kind=="pending-expire"){t.defer=true;owner.poll();now=2000001000001;t.late!!();assertEquals(ReceiverPhase.EXPIRED,owner.state.phase)}
            if(kind=="close"){t.defer=true;owner.poll();owner.close();t.late!!();assertEquals(ReceiverPhase.CLOSED,owner.state.phase)}
            owner.accept();assertEquals(0,t.accepts);assertNull(owner.state.result);assertFalse(owner.state.canAccept)
        }
    }
}
