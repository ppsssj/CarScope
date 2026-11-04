package io.carscope.app.lab

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
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
    private lateinit var receiverPanel: LinearLayout
    private lateinit var inspectionPanel: View
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
        receiverPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Button(this@InspectionActivity).apply {
                text = "3D로 돌아가기"; tag = "return-to-3d"
                setOnClickListener { showReceiver(false) }
            })
            bridgeStatus = TextView(this@InspectionActivity).apply {
                text = "Native에서 수락한 뒤 3D에서 기록을 직접 선택하세요."
                tag = "native-3d-status"; setPadding(24, 8, 24, 8)
            }
            addView(bridgeStatus)
            addView(nativeView, LinearLayout.LayoutParams(-1, 0, 1f))
            visibility = View.GONE
        }
        bridge = NativeInspectionBridge({ System.nanoTime() / 1_000_000 }, { request ->
            bridgeHandler.post {
                if (!bridgeStopped && bridge.isCurrent(request)) {
                    receiverTask(request.taskId)
                    if (bridge.arm(request)) showReceiver(true)
                }
            }
        }, { bridgeHandler.post { if (!bridgeStopped) { resetReceiver(); showReceiver(false) } } },
            { request -> bridgeHandler.post { if (!bridgeStopped && bridge.isCurrent(request)) showReceiver(true) } })
        tireStatus = TireUiChannel(TireProcessOwner.get(applicationContext))
        componentStatus = ComponentUiChannel(ComponentProcessOwner.get(applicationContext))
        screen = DebugWebScreen(this, TAG, HOST, ROOT, mapOf("external/ioniq5.glb" to File(filesDir, DebugWebScreen.MODEL_PATH)), tireStatus::readJson, componentStatus::readJson, componentStatus::readChargePortJson, componentStatus::readVisibilityJson, bridge::handle)
        inspectionPanel = screen.create(intent.getStringExtra("query").orEmpty())
        setContentView(FrameLayout(this).apply {
            addView(inspectionPanel, FrameLayout.LayoutParams(-1, -1))
            addView(receiverPanel, FrameLayout.LayoutParams(-1, -1))
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

    internal override fun onReceiverState(state: SyncReceiverState) {
        if (::bridge.isInitialized && !bridgeStopped) {
            bridge.state(state)
            bridgeStatus.text = when (bridge.blockingReason) {
                "SERVER_CLOCK_UNAVAILABLE", "ACCEPTED_NOT_BOUND" -> "3D 연결 차단: 서버 기준 시각 계약이 없습니다. Native 수락 결과를 3D에 적용할 수 없습니다."
                null -> "Native에서 수락한 뒤 3D에서 기록을 직접 선택하세요."
                else -> "3D 연결을 검증하지 못했습니다. 새 점검 세션이 필요합니다."
            }
        }
    }
    private fun showReceiver(show: Boolean) {
        if (show) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        showingReceiver = show
        receiverPanel.visibility = if (show) View.VISIBLE else View.GONE
        inspectionPanel.visibility = if (show) View.GONE else View.VISIBLE
        if (!show) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
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
    }
}
