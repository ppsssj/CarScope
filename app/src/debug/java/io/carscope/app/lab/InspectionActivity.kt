package io.carscope.app.lab

import android.app.Activity
import android.os.Bundle
import java.io.File
import io.carscope.app.tire.TireProcessOwner
import io.carscope.app.tire.TireUiChannel
import io.carscope.app.sync.InspectionSyncEntry
import io.carscope.app.component.ComponentProcessOwner
import io.carscope.app.component.ComponentUiChannel

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
    private lateinit var syncEntry: InspectionSyncEntry
    private lateinit var componentStatus: ComponentUiChannel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tireStatus = TireUiChannel(TireProcessOwner.get(applicationContext))
        componentStatus = ComponentUiChannel(ComponentProcessOwner.get(applicationContext))
        screen = DebugWebScreen(this, TAG, HOST, ROOT, mapOf("external/ioniq5.glb" to File(filesDir, DebugWebScreen.MODEL_PATH)), tireStatus::readJson, componentStatus::readJson, componentStatus::readChargePortJson, componentStatus::readVisibilityJson)
        syncEntry = InspectionSyncEntry(this)
        setContentView(syncEntry.wrap(screen.create(intent.getStringExtra("query").orEmpty())))
    }

    override fun onResume() {
        super.onResume()
        tireStatus.start()
        componentStatus.start()
        screen.resume()
        screen.signalTireStatus(true)
        screen.signalComponentStatus(true)
        syncEntry.resume()
    }

    override fun onPause() {
        syncEntry.pause()
        tireStatus.stop()
        componentStatus.stop()
        screen.signalTireStatus(false)
        screen.signalComponentStatus(false)
        screen.pause(isFinishing, "window.__androidShell && window.__androidShell.closeScreen('finish')")
        super.onPause()
    }

    override fun onDestroy() {
        tireStatus.stop()
        componentStatus.stop()
        screen.destroy()
        super.onDestroy()
    }

    @Deprecated("Debug Activity uses the shared inspection step navigation")
    override fun onBackPressed() { screen.inspectionBack() }

    private companion object {
        const val TAG = "CarScopeInspection"
        const val HOST = "carscope-inspection.invalid"
        const val ROOT = "inspection"
    }
}
