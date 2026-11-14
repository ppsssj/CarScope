package io.carscope.app.lab

/** Debug only: the app-private GLB filled by tools/three-poc/push-android-lab-model.mjs (run-as, debuggable builds only).
 * The Release screen bundles the model as an asset instead and never reads this path. */
internal object DebugModelFile {
    const val MODEL_PATH = "debug-3d-assets/ioniq5.glb"
}
