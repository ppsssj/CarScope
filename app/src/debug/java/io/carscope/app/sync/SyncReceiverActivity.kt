package io.carscope.app.sync

import android.app.Activity
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.text.DateFormat
import java.util.Date

/** Native Debug screen. Intent extras never configure trust or credentials. No saved tokens or global Activity owner. */
open class SyncReceiverActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var owner: SyncReceiverController? = null
    private var transport: ConnectedSyncReceiverTransport? = null
    private var check: SyncCancellation? = null
    private var generation = 0L
    private var stopped = true
    private var qrBitmap: Bitmap? = null
    private var shownQr: SyncQrPayload? = null
    private lateinit var status: TextView
    private lateinit var connection: TextView
    private lateinit var expiry: TextView
    private lateinit var summary: TextView
    private lateinit var image: ImageView
    private lateinit var create: Button
    private lateinit var accept: Button
    private lateinit var cancel: Button
    private lateinit var retry: Button
    private lateinit var probe: Button

    internal open fun endpoint(): SyncEndpoint? = try {
        val file = File(filesDir, "sync-endpoint.json")
        if (!file.isFile || file.length() > 2048) null else {
            val x = SyncHttpDecoder.objectBody(file.readBytes(), "application/json")
            if (x.keys != setOf("apiOrigin", "mobileRoot")) null else SyncEndpoint(x["apiOrigin"] as String, x["mobileRoot"] as String)
        }
    } catch (_: Exception) { null }
    internal open fun credentialProvider(): SessionCreationCredentialProvider = DenyByDefaultCredentialProvider()
    internal open fun now(): Long = System.currentTimeMillis()
    internal open fun newTransport(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher): ConnectedSyncReceiverTransport =
        HttpsSyncReceiverTransport(endpoint, credentialProvider(), dispatcher)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 24, 24, 24) }
        fun text(value: String, tagValue: String): TextView = TextView(this).apply { text = value; textSize = 18f; tag = tagValue; setPadding(0, 10, 0, 10); column.addView(this) }
        fun button(value: String, tagValue: String): Button = Button(this).apply { text = value; tag = tagValue; minHeight = 64; column.addView(this) }
        text("CarScope 워셔액 셀프 점검", "title").textSize = 24f
        text("사용자가 직접 확인한 보고입니다. 실제 차량 센서 진단이나 차량 상태 보증이 아닙니다.", "notice")
        connection = text("연결 설정 미완료", "connection")
        text("실제 차량 인증 미구현 · 생성 권한이 없으면 세션을 만들 수 없습니다.", "authentication")
        probe = button("서비스 연결 확인", "probe")
        create = button("점검 요청 생성", "create")
        status = text("IDLE · 새 요청을 준비하세요.", "status")
        expiry = text("", "expiry")
        image = ImageView(this).apply { tag = "qr"; contentDescription = "워셔액 점검 초대 QR · 공유하지 마세요"; visibility = View.GONE; isSaveEnabled = false }
        column.addView(image, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 512))
        summary = text("점검 결과 수신 전", "result")
        accept = button("이 결과 수락", "accept")
        cancel = button("점검 요청 취소", "cancel")
        retry = button("처리 상태 다시 확인", "retry")
        text("화면을 벗어나면 QR과 수신 권한을 버립니다. 화면 종료만으로 서버 취소가 완료되지는 않습니다.", "lifecycle")
        setContentView(ScrollView(this).apply { addView(column) })
    }
    override fun onStart() {
        super.onStart(); stopped = false; val current = ++generation
        val endpoint = endpoint()
        if (endpoint == null) {
            connection.text = "연결 설정 미완료 · 검증된 HTTPS 서비스/모바일 주소가 필요합니다."
            listOf(probe, create, accept, cancel, retry).forEach { it.isEnabled = false }; return
        }
        val dispatcher = SyncCallbackDispatcher { action -> handler.post { if (!stopped && generation == current) action() } }
        val connectionTransport = newTransport(endpoint, dispatcher); transport = connectionTransport
        val scheduler = SyncReceiverScheduler { delay, action ->
            val runnable = Runnable { if (!stopped && generation == current) action() }; handler.postDelayed(runnable, delay)
            SyncCancellation { handler.removeCallbacks(runnable) }
        }
        val controller = SyncReceiverController(SyncReceiverClient(connectionTransport, ::now), scheduler) { render(it) }
        owner = controller
        connection.text = "HTTPS 주소 설정됨 · 연결/TLS 미확인 · 생성 인증 기본 거부"
        probe.isEnabled = true
        probe.setOnClickListener {
            probe.isEnabled = false; connection.text = "HTTPS 서비스 확인 중…"
            check = connectionTransport.checkConnection { reply ->
                probe.isEnabled = true
                connection.text = if (reply is SyncReply.Success) "HTTPS 응답 확인 · 서버 인증서 검증 성공 · 차량 인증과는 별개입니다."
                    else "서비스 연결 실패 · 인증서/네트워크/설정을 확인하세요."
            }
        }
        create.setOnClickListener { controller.create(endpoint.mobileRoot) }
        accept.setOnClickListener { controller.accept() }; cancel.setOnClickListener { controller.cancel() }; retry.setOnClickListener { controller.retryPolling() }
        render(controller.state)
        val tick = object : Runnable {
            override fun run() {
                if (stopped || generation != current) return
                controller.hideExpiredInvite(now())
                handler.postDelayed(this, 1000)
            }
        }; handler.post(tick)
    }
    private fun render(state: SyncReceiverState) {
        if (stopped) return
        status.text = when (state.phase) {
            ReceiverPhase.WAITING -> "WAITING · 스마트폰 사용자 점검 대기"
            ReceiverPhase.RESULT_SUBMITTED -> "RESULT_SUBMITTED · 서버 수신 확인 · 사용자 수락 전"
            ReceiverPhase.ACCEPTED -> "ACCEPTED · 사용자 보고 결과 수락 완료"
            ReceiverPhase.CANCELLED -> "CANCELLED · 서버 취소 확인"
            ReceiverPhase.EXPIRED -> "EXPIRED · 새 요청이 필요합니다."
            ReceiverPhase.FAILED -> "FAILED · 연결 또는 응답을 확인할 수 없습니다."
            ReceiverPhase.CLOSED -> "CLOSED · 이 화면의 연결을 종료했습니다. 원격 취소를 확인한 것은 아닙니다."
            else -> state.phase.name
        } + if (state.failure != null) "\n요청 실패: ${state.failure.name} · 취소/수락 성공이 아닙니다." else ""
        summary.text = state.result?.let { result ->
            val label = when (result.status) { ReportedStatus.OK -> "정상으로 보고"; ReportedStatus.NEEDS_REFILL -> "보충 필요"; ReportedStatus.UNSURE -> "확인 불가" }
            "워셔액 셀프 점검\n사용자 보고 결과: $label\n완료 시각: ${result.completedAt}\nSELF · USER_REPORTED\n실제 차량 센서 진단이 아닙니다."
        } ?: state.summary()
        fun format(value: Long?) = value?.let { DateFormat.getDateTimeInstance().format(Date(it)) } ?: "-"
        expiry.text = "QR 초대 만료: ${format(state.inviteExpiresAt)}\n세션 만료: ${format(state.expiresAt)}"
        if (shownQr !== state.qr) {
            clearQr(); val payload = state.qr
            if (payload != null) try {
                qrBitmap = SyncQrRenderer.bitmap(payload); image.setImageBitmap(qrBitmap); image.visibility = View.VISIBLE; shownQr = payload
            } catch (_: Exception) { image.visibility = View.GONE; status.text = "FAILED · QR 표시 실패. 요청을 취소하고 다시 시작하세요." }
        }
        create.isEnabled = transport?.creationAuthorized() == true && !state.busy && state.phase in listOf(ReceiverPhase.IDLE, ReceiverPhase.FAILED, ReceiverPhase.CANCELLED, ReceiverPhase.EXPIRED)
        accept.isEnabled = state.canAccept; cancel.isEnabled = state.canCancel; retry.isEnabled = state.retryAvailable && !state.busy
    }
    private fun clearQr() { image.setImageDrawable(null); image.visibility = View.GONE; qrBitmap?.recycle(); qrBitmap = null; shownQr = null }
    override fun onStop() {
        stopped = true; generation++; handler.removeCallbacksAndMessages(null); check?.cancel(); check = null
        owner?.close(); owner = null; transport?.close(); transport = null; clearQr()
        listOf(create, accept, cancel, retry, probe).forEach { it.isEnabled = false }
        super.onStop()
    }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); transport?.close(); clearQr(); super.onDestroy() }
}
