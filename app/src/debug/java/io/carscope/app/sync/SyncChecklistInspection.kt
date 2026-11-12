package io.carscope.app.sync

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Collections

/** Reviewed schema-v2 profiles only. Adding a profile requires matching mobile/server contract vectors. */
internal data class SyncChecklistProfile(val label: String, val responseLabels: Map<String, String>, val partId: String) {
    val responseKeys: Set<String> get() = responseLabels.keys
}
internal object SyncChecklistTasks {
    private val tank = linkedMapOf("levelMarking" to "외부 액면·표시 범위", "leakTrace" to "주변 젖음·흐른 흔적", "exteriorDamage" to "저장통·캡 외관")
    private val wiper = linkedMapOf("bladeDamage" to "블레이드 고무 손상", "visibleDebris" to "블레이드 주변 이물질", "armDamage" to "와이퍼 암 외관")
    private val lamp = linkedMapOf("lensDamage" to "렌즈 손상", "obstruction" to "렌즈 영역 가림", "visibleMoisture" to "렌즈 안쪽 물기")
    val profiles = linkedMapOf("brake-fluid" to SyncChecklistProfile("브레이크액", linkedMapOf(
        "levelMarking" to "외부 액면·MIN/MAX 표시", "leakTrace" to "누출 의심 흔적", "exteriorDamage" to "리저버·캡 외관 손상"
    ), "brake-fluid-reservoir"),
        "coolant-reservoir" to SyncChecklistProfile("냉각수 리저버", tank, "coolant-reservoir"),
        "lcw-coolant-reservoir" to SyncChecklistProfile("저전도 냉각수 리저버", tank, "lcw-coolant-reservoir"),
        "battery-12v" to SyncChecklistProfile("12V 보조 배터리", linkedMapOf("caseDamage" to "12V 케이스 외관", "leakTrace" to "누액 의심 흔적", "visibleCorrosion" to "노출 부분 부식 의심 흔적"), "battery-12v"),
        "fuse-box" to SyncChecklistProfile("모터룸 퓨즈박스", linkedMapOf("coverDamage" to "닫힌 덮개 외관", "visibleContamination" to "덮개 주변 젖음·오염", "heatDamage" to "덮개 변형·변색"), "fuse-box"),
        "wiper.front.left" to SyncChecklistProfile("전면 왼쪽 와이퍼", wiper, "wiper.front.left"),
        "wiper.front.right" to SyncChecklistProfile("전면 오른쪽 와이퍼", wiper, "wiper.front.right"),
        "light-low-beam-left-0" to SyncChecklistProfile("왼쪽 하향등", lamp, "light-low-beam-left-0"),
        "light-low-beam-right-0" to SyncChecklistProfile("오른쪽 하향등", lamp, "light-low-beam-right-0"),
        "light-high-beam-left-0" to SyncChecklistProfile("왼쪽 상향등", lamp, "light-high-beam-left-0"),
        "light-high-beam-right-0" to SyncChecklistProfile("오른쪽 상향등", lamp, "light-high-beam-right-0")
    )
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
