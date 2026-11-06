package io.carscope.app.lab

import android.graphics.Color
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
import android.widget.LinearLayout
import android.widget.TextView
import io.carscope.app.sync.ReceiverPhase
import io.carscope.app.sync.SyncReceiverActivity
import io.carscope.app.sync.SyncReceiverState
import io.carscope.app.sync.NativeInspectionBridge
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
                text = "Native에서 수락한 뒤 3D에서 기록을 직접 선택하세요."
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
                    if (bridge.arm(request)) { showReceiver(true); createWhenAuthorized(request.taskId) }
                }
            }
        }, { bridgeHandler.post { if (!bridgeStopped) { resetReceiver(); showReceiver(false) } } },
            { request -> bridgeHandler.post { if (!bridgeStopped && bridge.isCurrent(request)) showReceiver(true) } },
            { line -> Log.i(TAG, "CARSCOPE_NATIVE_BRIDGE $line") })
        tireStatus = TireUiChannel(TireProcessOwner.get(applicationContext))
        componentStatus = ComponentUiChannel(ComponentProcessOwner.get(applicationContext))
        screen = DebugWebScreen(this, TAG, HOST, ROOT, mapOf("external/ioniq5.glb" to File(filesDir, DebugWebScreen.MODEL_PATH)), tireStatus::readJson, componentStatus::readJson, componentStatus::readChargePortJson, componentStatus::readVisibilityJson, bridge::handle, newAvdHistoryChannel()::handle)
        inspectionPanel = screen.create(intent.getStringExtra("query").orEmpty())
        webFocusability = inspectionPanel.descendantFocusability
        setContentView(FrameLayout(this).apply {
            addView(inspectionPanel, FrameLayout.LayoutParams(-1, -1))
            addView(receiverOverlay, FrameLayout.LayoutParams(-1, -1))
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
        bridge.suspend() // background/rotation/Back revokes the token-free binding and proof vault
        showReceiver(false)
        super.onStop() // closes receiver credentials, HTTP, polls and provisioning
    }

    internal override fun provisionOnStart() = false
    internal override fun creationPanelVisible() = showingReceiver

    internal override fun onReceiverState(state: SyncReceiverState) {
        if (::bridge.isInitialized && !bridgeStopped) {
            bridge.state(state)
            val noRequest = state.phase == ReceiverPhase.IDLE || state.phase == ReceiverPhase.CANCELLED || state.phase == ReceiverPhase.EXPIRED
            closePanel.text = if (noRequest) "패널 닫기" else "패널 닫기 · 점검 요청 유지"
            closeNote.text = if (noRequest) NO_REQUEST_NOTE else "패널을 닫아도 서버의 점검 요청은 취소되지 않습니다. 취소하려면 아래 '점검 요청 취소'를 누르세요."
            bridgeStatus.text = when (bridge.blockingReason) {
                "SERVER_CLOCK_UNAVAILABLE", "ACCEPTED_NOT_BOUND" -> "3D 연결 차단: 서버 기준 시각 계약이 없습니다. Native 수락 결과를 3D에 적용할 수 없습니다."
                null -> "Native에서 수락한 뒤 3D에서 기록을 직접 선택하세요."
                else -> "3D 연결을 검증하지 못했습니다. 새 점검 세션이 필요합니다."
            }
        }
    }
    /** Closing hides the panel only. The server session, its polling and the QR stay until Cancel, stop or expiry. */
    private fun showReceiver(show: Boolean) {
        if (show) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        showingReceiver = show
        lock3dInput(show)
        receiverOverlay.visibility = if (show) View.VISIBLE else View.GONE
        if (show) closePanel.requestFocus()
        if (!show) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
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
