package io.carscope.app.lab

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.carscope.app.component.ComponentProcessOwner
import io.carscope.app.component.ComponentUiChannel
import io.carscope.app.sync.NativeInspectionBridge
import io.carscope.app.tire.TireProcessOwner
import io.carscope.app.tire.TireUiChannel

/**
 * Release 3D inspection screen (contest submission). The same page, geometry and read-only Pleos status channels as the
 * Debug screen; the IONIQ 5 GLB is a bundled asset (`inspection/external/ioniq5.glb`, CC BY 4.0 / MPL-2.0 attribution
 * in the page and README). There is no phone sync here: no network permission, endpoint, enrollment, credential or QR
 * code. A phone request is answered with the fixed BUILD_UNSUPPORTED status, so the page says so instead of waiting.
 */
class InspectionActivity : Activity() {
    private lateinit var screen: DebugWebScreen
    private lateinit var tireStatus: TireUiChannel
    private lateinit var componentStatus: ComponentUiChannel
    private lateinit var bridge: NativeInspectionBridge
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bridge = NativeInspectionBridge({ System.nanoTime() / 1_000_000 }, { request ->
            // Status words only. Nothing is created, sent or stored for the request.
            handler.post { if (bridge.isCurrent(request)) bridge.receiverStatus(unsupported(request.taskId)) }
        }, { handler.post { bridge.receiverStatus(null) } },
            { request -> handler.post { if (bridge.isCurrent(request)) bridge.receiverStatus(unsupported(request.taskId)) } },
            { line -> Log.i(TAG, "CARSCOPE_NATIVE_BRIDGE $line") }, buildUnsupported = true)
        tireStatus = TireUiChannel(TireProcessOwner.get(applicationContext))
        componentStatus = ComponentUiChannel(ComponentProcessOwner.get(applicationContext))
        screen = DebugWebScreen(this, TAG, HOST, ROOT, emptyMap(), tireStatus::readJson, componentStatus::readJson,
            componentStatus::readChargePortJson, componentStatus::readVisibilityJson, componentStatus::readOdometerJson, bridge::handle)
        setContentView(screen.create(intent.getStringExtra("query").orEmpty()))
    }

    override fun onResume() {
        super.onResume()
        bridge.resume()
        tireStatus.start()
        componentStatus.start()
        screen.resume()
        screen.signalTireStatus(true)
        screen.signalComponentStatus(true)
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

    override fun onDestroy() {
        bridge.destroy()
        handler.removeCallbacksAndMessages(null)
        tireStatus.stop()
        componentStatus.stop()
        screen.destroy()
        super.onDestroy()
    }

    @Deprecated("Shares the inspection step navigation with the page")
    override fun onBackPressed() = screen.inspectionBack()

    internal companion object {
        const val TAG = "CarScopeInspection"
        const val HOST = "carscope-inspection.invalid"
        const val ROOT = "inspection"
        fun unsupported(taskId: String): Map<String, Any?> = mapOf("taskId" to taskId, "phase" to "BUILD_UNSUPPORTED",
            "failure" to null, "retryAvailable" to false, "canCancel" to false, "inviteExpiresAt" to null)
    }
}
