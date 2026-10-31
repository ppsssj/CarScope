package io.carscope.app.profile

import io.carscope.visualization.VehicleAssetResolver
import io.carscope.visualization.VehicleVisualAsset
import io.carscope.visualization.VisualAssetResolution
import io.carscope.visualization.VisualProfile
import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/** Debug-only external drawing store (P2-A8). Synthetic files only. */
class DebugVisualAssetStoreTest {
    private val ioniq = VisualProfile.HYUNDAI_IONIQ5_2022
    private fun store() = DebugVisualAssetStore(Files.createTempDirectory("carscope-files").toFile())

    @Test fun `files live under the app-private debug directory and are named by profile id`() {
        val s = store()
        assertEquals(File(s.directory, "hyundai-ioniq5-2022.parts"), s.fileFor(ioniq))
        assertEquals("debug-visual-assets", s.directory.name)
    }

    @Test fun `missing file reads as null and the default profile never reads a file`() {
        val s = store()
        assertNull(s.read(ioniq))
        s.directory.mkdirs()
        s.fileFor(VisualProfile.DEFAULT).writeText("ignored")
        assertNull(s.read(VisualProfile.DEFAULT))
    }

    @Test fun `oversized file is refused before reading it`() {
        val s = store()
        s.directory.mkdirs()
        java.io.RandomAccessFile(s.fileFor(ioniq), "rw").use { it.setLength(VehicleVisualAsset.MAX_BYTES + 1L) }
        assertThrows(IOException::class.java) { s.read(ioniq) }
        val r = VehicleAssetResolver(s::read).resolve(ioniq)
        assertTrue((r as VisualAssetResolution.Fallback).reason.startsWith("ASSET_UNREADABLE"))
        assertSame(VehicleVisualAsset.default, r.asset)
    }

    @Test fun `an invalid file falls back to the bundled reference`() {
        val s = store()
        s.directory.mkdirs()
        s.fileFor(ioniq).writeText("#carscope-anatomy-car 1\n#viewbox 640 330\n@static\n<script/>\n")
        val r = VehicleAssetResolver(s::read).resolve(ioniq)
        assertTrue(r is VisualAssetResolution.Fallback)
        assertEquals(VisualProfile.DEFAULT, r.asset.profile)
    }
}
