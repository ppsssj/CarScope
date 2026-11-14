package io.carscope.app.lab

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import io.carscope.app.sync.ReceiverPhase
import io.carscope.app.sync.SyncReceiverActivity
import io.carscope.app.sync.SyncReceiverState
import io.carscope.app.sync.NativeInspectionBridge
import io.carscope.app.sync.NativePanelCommand
import android.os.Bundle
import java.io.File
import io.carscope.app.tire.TireProcessOwner
import io.carscope.app.tire.TireUiChannel
import io.carscope.app.component.ComponentProcessOwner
import io.carscope.app.component.ComponentUiChannel

/**
 * Debug-only P3-A5.2: the P3-A4 vehicle inspection flow (tools/three-poc/inspect.html) inside the Pleos AVD.
 * Page, flow and geometry modules are the browser ones, packaged by build-android-inspection.mjs into the
 * `inspection` debug assets with a small Android shell (close, zoom buttons, logcat events). Hosting and security
 * come from [DebugWebScreen]; the GLB is the app-private file shared with [Ioniq5LabActivity], served only at
 * `external/ioniq5.glb`. Tire status is a read-only projection of the shared debug process cache.
 */
open class InspectionActivity : SyncReceiverActivity() {
    private lateinit var screen: DebugWebScreen
    private lateinit var tireStatus: TireUiChannel
    private lateinit var bridge: NativeInspectionBridge
    private lateinit var receiverOverlay: FrameLayout
    private lateinit var closePanel: Button
    private lateinit var closeNote: TextView
    private lateinit var inspectionPanel: WebView
    private var webFocusability = ViewGroup.FOCUS_BEFORE_DESCENDANTS
    private val bridgeHandler = Handler(Looper.getMainLooper())
    private var bridgeStopped = false
    private var showingReceiver = false
    private lateinit var bridgeStatus: TextView
    private lateinit var componentStatus: ComponentUiChannel
    // Drawn over a slot the page reserves in its part panel, so the page lays the QR out without ever holding it.
    private lateinit var inlineQr: ImageView
    private var inlineActive = false
    private var inlineBitmap: Bitmap? = null
    private var slotCommand = NativePanelCommand("slot")
    private var lastQrLog = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The parent protects its QR/result UI. Keep that on the receiver panel only, not the existing 3D page.
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val nativeView = findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        (nativeView.parent as ViewGroup).removeView(nativeView)
        closePanel = Button(this).apply {
            text = "패널 닫기"; tag = "close-panel"
            setOnClickListener { showReceiver(false) }
        }
        closeNote = TextView(this).apply { text = NO_REQUEST_NOTE; tag = "close-note"; setPadding(24, 8, 24, 0) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; tag = "receiver-panel"
            setBackgroundColor(Color.WHITE); elevation = dp(16).toFloat()
            addView(closePanel)
            addView(closeNote)
            bridgeStatus = TextView(this@InspectionActivity).apply {
                text = "3D 결과 반영 상태 확인 전"
                tag = "native-3d-status"; setPadding(24, 8, 24, 8)
            }
            addView(bridgeStatus)
            addView(nativeView, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        // Clickable full-window layer: touches outside the panel stop here, so the 3D stays visible but receives none.
        // There is no tap-outside close: only the explicit button or Back closes the panel.
        val place = receiverOverlayPlacement(resources.configuration.screenWidthDp, resources.configuration.screenHeightDp)
        receiverOverlay = FrameLayout(this).apply {
            // Not focusable: a clickable View resolves to focusable by default and would catch DPAD focus while invisible.
            tag = "receiver-overlay"; isClickable = true; isFocusable = false; setBackgroundColor(OVERLAY_DIM); visibility = View.GONE
            addView(panel, FrameLayout.LayoutParams(dp(place.widthDp), place.heightDp?.let(::dp) ?: FrameLayout.LayoutParams.MATCH_PARENT,
                if (place.side) Gravity.END else Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(place.topDp) })
        }
        bridge = NativeInspectionBridge({ System.nanoTime() / 1_000_000 }, { request ->
            bridgeHandler.post {
                if (!bridgeStopped && bridge.isCurrent(request)) {
                    receiverTask(request.taskId)
                    if (bridge.arm(request)) { inlineActive = true; createWhenAuthorized(request.taskId); publishPanelStatus() }
                }
            }
        }, { bridgeHandler.post { if (!bridgeStopped) { inlineActive = false; slotCommand = NativePanelCommand("slot"); resetReceiver(); showReceiver(false) } } },
            { request -> bridgeHandler.post { if (!bridgeStopped && bridge.isCurrent(request)) { inlineActive = true; updateInlineQr() } } },
            { line -> Log.i(TAG, "CARSCOPE_NATIVE_BRIDGE $line") },
            { command -> bridgeHandler.post { if (!bridgeStopped) panelCommand(command) } })
        tireStatus = TireUiChannel(TireProcessOwner.get(applicationContext))
        componentStatus = ComponentUiChannel(ComponentProcessOwner.get(applicationContext))
        screen = DebugWebScreen(this, TAG, HOST, ROOT, mapOf("external/ioniq5.glb" to File(filesDir, DebugWebScreen.MODEL_PATH)), tireStatus::readJson, componentStatus::readJson, componentStatus::readChargePortJson, componentStatus::readVisibilityJson, componentStatus::readOdometerJson, bridge::handle, newAvdHistoryChannel()::handle)
        inspectionPanel = screen.create(intent.getStringExtra("query").orEmpty())
        webFocusability = inspectionPanel.descendantFocusability
        // A resized WebView changes the scale: place the QR again after this layout pass (the page reports its new slot too).
        inspectionPanel.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob ->
            if (l != ol || t != ot || r != or || b != ob) onInlineQrHostLaidOut()
        }
        inlineQr = ImageView(this).apply {
            tag = "inline-qr"; contentDescription = "모바일 점검 초대 QR · 공유하지 마세요"; visibility = View.GONE; isSaveEnabled = false
            isClickable = false; isFocusable = false; scaleType = ImageView.ScaleType.FIT_CENTER
        }
        setContentView(FrameLayout(this).apply {
            addView(inspectionPanel, FrameLayout.LayoutParams(-1, -1))
            addView(receiverOverlay, FrameLayout.LayoutParams(-1, -1))
            addView(inlineQr, FrameLayout.LayoutParams(0, 0))
        })
    }

    override fun onResume() {
        super.onResume()
        bridge.resume()
        tireStatus.start()
        componentStatus.start()
        screen.resume()
        screen.signalTireStatus(true)
        screen.signalComponentStatus(true)
        bridgeStopped = false
    }

    override fun onPause() {
        bridge.suspend()
        tireStatus.stop()
        componentStatus.stop()
        screen.signalTireStatus(false)
        screen.signalComponentStatus(false)
        screen.pause(isFinishing, "window.__androidShell && window.__androidShell.closeScreen('finish')")
        super.onPause()
    }

    override fun onStop() {
        bridgeStopped = true
        bridgeHandler.removeCallbacksAndMessages(null)
        inlineActive = false; slotCommand = NativePanelCommand("slot")
        bridge.suspend() // background/rotation/Back revokes the token-free binding and proof vault
        showReceiver(false)
        super.onStop() // closes receiver credentials, HTTP, polls and provisioning
    }

    internal override fun provisionOnStart() = false
    internal override fun creationPanelVisible() = showingReceiver || inlineActive
    // A vehicle owner path keeps the explicit Accept in the management panel. This never records an owner's approval.
    internal override fun autoConfirmReceivedResult() = usesAvdSimulator
    internal override fun onQrBitmap(bitmap: Bitmap?) {
        if (bitmap == null) inlineQr.setImageDrawable(null) else inlineQr.setImageBitmap(bitmap)
        inlineBitmap = bitmap
        updateInlineQr()
    }

    private fun panelCommand(command: NativePanelCommand) {
        when (command.action) {
            "slot" -> {
                slotCommand = command; inlineActive = command.slot != "NONE"
                updateInlineQr()
            }
            // P22: "다시 확인" asks for a grant again after a refusal; otherwise it retries the result polling as before.
            "refresh" -> if (authorityRetryAvailable) { retryAuthority(); publishPanelStatus() } else retryReceiver()
            "cancel" -> cancelReceiver()
            "admin" -> showReceiver(true)
        }
    }

    /** The WebView's laid-out bounds in the frame that also holds the QR. Tests override it: Robolectric's WebView takes no frame. */
    internal open fun inlineQrHost(): Rect = Rect(inspectionPanel.left, inspectionPanel.top, inspectionPanel.right, inspectionPanel.bottom)
    /** A resized WebView changes the scale: place the QR again after the layout pass. */
    internal fun onInlineQrHostLaidOut() { bridgeHandler.post { if (!bridgeStopped) updateInlineQr() } }
    /** Only a QR that fits the visible page is drawn, and the window is secure only while one is.
     * The slot is converted once, by [InlineQrPlacement]; an unlaid-out WebView draws nothing. */
    private fun updateInlineQr() {
        val host = inlineQrHost()
        val place = if (inlineBitmap != null && !showingReceiver && !bridgeStopped) InlineQrPlacement.place(slotCommand,
            host.left, host.top, host.width(), host.height(), resources.displayMetrics.density) else null
        if (place != null) (inlineQr.layoutParams as FrameLayout.LayoutParams).let {
            if (it.width != place.size || it.height != place.size || it.leftMargin != place.left || it.topMargin != place.top) {
                it.width = place.size; it.height = place.size; it.leftMargin = place.left; it.topMargin = place.top; inlineQr.layoutParams = it
            }
        }
        inlineQr.visibility = if (place != null) View.VISIBLE else View.GONE
        // Geometry only: no QR content, invite or token is ever part of this line.
        val line = place?.let { "shown left=${it.left} top=${it.top} size=${it.size} scale=${"%.3f".format(it.scale)} density=${resources.displayMetrics.density}" } ?: "hidden slot=${slotCommand.slot}"
        if (line != lastQrLog) { lastQrLog = line; Log.i(TAG, "CARSCOPE_INLINE_QR $line") }
        if (place != null || showingReceiver) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    /** Words for the page's own panel. No QR, invite, receiver token or grant passes through here. */
    private fun publishPanelStatus() {
        val taskId = requestedReceiverTask
        val state = receiverState
        bridge.receiverStatus(if (taskId == null) null else mapOf("taskId" to taskId,
            "phase" to panelPhase(state, creationAuthorityStatus), "failure" to state?.failure?.name,
            "retryAvailable" to ((state?.retryAvailable == true && state.busy.not()) || authorityRetryAvailable), "canCancel" to (state?.canCancel == true),
            "inviteExpiresAt" to state?.inviteExpiresAt))
    }
    private fun panelPhase(state: SyncReceiverState?, authority: String): String = when (state?.phase) {
        null -> if (authority == "NOT_CONFIGURED") "NOT_CONFIGURED" else "AUTH_FAILED"
        ReceiverPhase.IDLE -> when (authority) { "GRANTED" -> "CREATING"; "DENIED" -> "AUTH_FAILED"; "NOT_CONFIGURED" -> "NOT_CONFIGURED"; else -> "AUTH_WAITING" }
        ReceiverPhase.CREATING -> "CREATING"
        ReceiverPhase.WAITING -> if (state.phoneClaimed) "CONNECTED" else if (state.qr != null) "QR_READY" else "QR_EXPIRED"
        // The simulator confirms on its own; any other path waits for the explicit Accept, and the page must say which.
        ReceiverPhase.RESULT_SUBMITTED -> if (autoConfirmReceivedResult()) "RESULT_RECEIVED" else "AWAITING_CONFIRMATION"
        ReceiverPhase.ACCEPTED -> "COMPLETED"
        ReceiverPhase.CANCELLED -> "CANCELLED"
        ReceiverPhase.EXPIRED -> "EXPIRED"
        ReceiverPhase.FAILED -> "FAILED"
        ReceiverPhase.CLOSED -> "CLOSED"
    }

    internal override fun onReceiverState(state: SyncReceiverState) {
        if (::bridge.isInitialized && !bridgeStopped) {
            bridge.state(state)
            publishPanelStatus()
            val noRequest = state.phase == ReceiverPhase.IDLE || state.phase == ReceiverPhase.CANCELLED || state.phase == ReceiverPhase.EXPIRED
            closePanel.text = if (noRequest) "패널 닫기" else "패널 닫기 · 점검 요청 유지"
            closeNote.text = if (noRequest) NO_REQUEST_NOTE else "패널을 닫아도 서버의 점검 요청은 취소되지 않습니다. 취소하려면 아래 '점검 요청 취소'를 누르세요."
            bridgeStatus.text = when (bridge.blockingReason) {
                "SERVER_CLOCK_UNAVAILABLE", "ACCEPTED_NOT_BOUND" -> "3D 연결 차단: 서버 기준 시각 계약이 없습니다. Native 수락 결과를 3D에 적용할 수 없습니다."
                null -> bridgeIdleText()
                else -> "3D 연결을 검증하지 못했습니다. 새 점검 세션이 필요합니다."
            }
        }
    }
    /** The 3D page shows the newest verified result by itself; only the explicit path needs this panel's Accept first. */
    private fun bridgeIdleText() = if (autoConfirmReceivedResult())
        "AVD 시뮬레이션: 검증을 통과한 결과는 수락 버튼 없이 3D에 반영됩니다. 차량 소유자 승인이 아닙니다."
        else "이 패널에서 결과를 수락하면 3D에 반영됩니다."
    /** The Debug management panel. Closing hides it only: the server session, polling and QR stay until Cancel, stop or expiry. */
    private fun showReceiver(show: Boolean) {
        if (show) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        showingReceiver = show
        lock3dInput(show)
        receiverOverlay.visibility = if (show) View.VISIBLE else View.GONE
        if (show) closePanel.requestFocus()
        updateInlineQr()
    }
    /** The page stays visible and keeps its state; keys, rotary focus and accessibility follow the panel meanwhile. */
    private fun lock3dInput(locked: Boolean) {
        inspectionPanel.isFocusable = !locked
        inspectionPanel.isFocusableInTouchMode = !locked
        inspectionPanel.descendantFocusability = if (locked) ViewGroup.FOCUS_BLOCK_DESCENDANTS else webFocusability
        inspectionPanel.importantForAccessibility =
            if (locked) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        if (locked) inspectionPanel.clearFocus()
    }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    override fun onDestroy() {
        bridge.destroy()
        bridgeHandler.removeCallbacksAndMessages(null)
        tireStatus.stop()
        componentStatus.stop()
        screen.destroy()
        super.onDestroy()
    }

    @Deprecated("Debug Activity uses the shared inspection step navigation")
    override fun onBackPressed() { if (showingReceiver) showReceiver(false) else screen.inspectionBack() }

    private companion object {
        const val TAG = "CarScopeInspection"
        const val HOST = "carscope-inspection.invalid"
        const val ROOT = "inspection"
        const val OVERLAY_DIM = 0x33000000
        const val NO_REQUEST_NOTE = "현재 진행 중인 점검 요청이 없습니다."
    }
}
