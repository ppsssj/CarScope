package io.carscope.app.profile

import io.carscope.visualization.VehicleVisualAsset
import io.carscope.visualization.VisualProfile
import java.io.File
import java.io.IOException

/**
 * Debug-only source of non-bundled drawings: `<app files>/debug-visual-assets/<profile id>.parts`.
 * The directory is private to this app; on the AVD it is filled with `adb shell run-as`, which only
 * works for debuggable builds. Nothing is downloaded and no shared storage is used.
 */
class DebugVisualAssetStore(filesDir: File) {
    val directory = File(filesDir, DIRECTORY)

    fun fileFor(profile: VisualProfile) = File(directory, "${profile.id}.parts")

    /** Bytes for [profile], null when absent. The bundled default profile never reads a file. */
    fun read(profile: VisualProfile): ByteArray? {
        if (profile == VisualProfile.DEFAULT) return null
        val file = fileFor(profile)
        if (!file.isFile) return null
        if (file.length() > VehicleVisualAsset.MAX_BYTES) throw IOException("file is ${file.length()} bytes, limit ${VehicleVisualAsset.MAX_BYTES}")
        return file.readBytes()
    }

    companion object {
        const val DIRECTORY = "debug-visual-assets"
    }
}
