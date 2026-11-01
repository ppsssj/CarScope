package io.carscope.app.lab

import android.app.Activity
import android.os.Bundle
import java.io.File
import io.carscope.app.tire.TireProcessOwner
import io.carscope.app.tire.TireUiChannel

/**
 * Debug-only P3-A5.2: the P3-A4 vehicle inspection flow (tools/three-poc/inspect.html) inside the Pleos AVD.
 * Page, flow and geometry modules are the browser ones, packaged by build-android-inspection.mjs into the
 * `inspection` debug assets with a small Android shell (close, zoom buttons, logcat events). Hosting and security
 * come from [DebugWebScreen]; the GLB is the app-private file shared with [Ioniq5LabActivity], served only at
 * `external/ioniq5.glb`. Tire status is a read-only projection of the shared debug process cache.
 */
class InspectionActivity : Activity() {
    private lateinit var screen: DebugWebScreen
    private lateinit var tireStatus: TireUiChannel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tireStatus = TireUiChannel(TireProcessOwner.get(applicationContext))
        screen = DebugWebScreen(this, TAG, HOST, ROOT, mapOf("external/ioniq5.glb" to File(filesDir, DebugWebScreen.MODEL_PATH)), tireStatus::readJson)
        setContentView(screen.create(intent.getStringExtra("query").orEmpty()))
    }

    override fun onResume() {
        super.onResume()
        tireStatus.start()
        screen.resume()
        screen.signalTireStatus(true)
    }

    override fun onPause() {
        tireStatus.stop()
        screen.signalTireStatus(false)
        screen.pause(isFinishing, "window.__androidShell && window.__androidShell.closeScreen('finish')")
        super.onPause()
    }

    override fun onDestroy() {
        tireStatus.stop()
        screen.destroy()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "CarScopeInspection"
        const val HOST = "carscope-inspection.invalid"
        const val ROOT = "inspection"
    }
}
