package io.carscope.app.sync

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Collections

/** Reviewed schema-v2 profiles only. Adding a profile requires matching mobile/server contract vectors. */
internal data class SyncChecklistProfile(val label: String, val responseLabels: Map<String, String>) {
    val responseKeys: Set<String> get() = responseLabels.keys
}
internal object SyncChecklistTasks {
    val profiles = mapOf("brake-fluid" to SyncChecklistProfile("브레이크액", linkedMapOf(
        "levelMarking" to "외부 액면·MIN/MAX 표시", "leakTrace" to "누출 의심 흔적", "exteriorDamage" to "리저버·캡 외관 손상"
    )))
}
internal enum class ChecklistAnswer { FOUND, NOT_FOUND, UNABLE }
internal enum class ChecklistReportedStatus { REVIEW_NEEDED, UNABLE, NO_FINDINGS_REPORTED }

/** User observations only. No SDK support check gates mobile inspection. */
internal class CompletedChecklistInspection(
    override val inspectionId: String, override val taskId: String,
    override val startedAt: String, override val completedAt: String,
    responses: Map<String, ChecklistAnswer>, val cameraUsed: Boolean, val locationMarked: Boolean,
    val status: ChecklistReportedStatus
) : SyncInspection {
    val responses: Map<String, ChecklistAnswer> = Collections.unmodifiableMap(responses.toMap())
    override val statusName: String get() = status.name
    fun computedStatus() = when {
        ChecklistAnswer.FOUND in responses.values -> ChecklistReportedStatus.REVIEW_NEEDED
        ChecklistAnswer.UNABLE in responses.values -> ChecklistReportedStatus.UNABLE
        else -> ChecklistReportedStatus.NO_FINDINGS_REPORTED
    }
    override fun valid(): Boolean = try {
        val profile = SyncChecklistTasks.profiles[taskId]
        profile != null && responses.keys == profile.responseKeys && status == computedStatus() &&
            Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}").matches(inspectionId) &&
            listOf(startedAt, completedAt).all {
                DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC).format(Instant.parse(it)) == it
            } && !Instant.parse(completedAt).isBefore(Instant.parse(startedAt))
    } catch (_: Exception) { false }
    override fun canonicalJson(): String {
        require(valid())
        val answers = responses.toSortedMap().entries.joinToString(",") { "\"${it.key}\":\"${it.value}\"" }
        return """{"aids":{"cameraUsed":$cameraUsed,"locationMarked":$locationMarked},"completedAt":"$completedAt","confirmation":"USER_REPORTED","inspectionId":"$inspectionId","method":"SELF","responses":{$answers},"schemaVersion":2,"source":"MOBILE","startedAt":"$startedAt","state":"COMPLETED","status":"$status","sync":"NOT_SENT","taskId":"$taskId"}"""
    }
}
