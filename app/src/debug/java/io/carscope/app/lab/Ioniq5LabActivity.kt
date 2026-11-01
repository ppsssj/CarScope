package io.carscope.app.lab

import android.app.Activity
import android.os.Bundle
import java.io.File

/**
 * Debug-only P3-A5.1 experiment: renders the IONIQ 5 reference model with Three.js in a WebView to check
 * WebGL compatibility on the Pleos AVD. Not reachable in release builds; the main screen's WebView keeps
 * JavaScript disabled. Hosting and security are in [DebugWebScreen]: page files from the `ioniq5-lab` debug
 * assets, the third-party GLB from app-private storage at exactly one path, `model.glb`.
 */
class Ioniq5LabActivity : Activity() {
    private lateinit var screen: DebugWebScreen

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screen = DebugWebScreen(this, TAG, HOST, ROOT, mapOf("model.glb" to File(filesDir, DebugWebScreen.MODEL_PATH)))
        setContentView(screen.create(intent.getStringExtra("query").orEmpty()))
    }

    override fun onResume() {
        super.onResume()
        screen.resume()
    }

    override fun onPause() {
        screen.pause(isFinishing, "window.__lab && window.__lab.dispose('finish')")
        super.onPause()
    }

    override fun onDestroy() {
        screen.destroy()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "CarScopeIoniq5Lab"
        const val HOST = "carscope-ioniq5-lab.invalid"
        const val ROOT = "ioniq5-lab"
    }
}
