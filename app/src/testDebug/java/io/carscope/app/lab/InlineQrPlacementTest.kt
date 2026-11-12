package io.carscope.app.lab

import io.carscope.app.sync.NativePanelCommand
import org.junit.Assert.*
import org.junit.Test

/** The page's QR slot is converted to Native pixels once, by the measured WebView scale, never by display density. */
class InlineQrPlacementTest {
    // Recorded Pleos AVD (docs/p3-a5-2-android-inspection.md): window 1682×1210 px, page CSS 1224×880, devicePixelRatio 1.375,
    // display density 160 (displayMetrics.density 1.0).
    private val webW = 1682; private val webH = 1210; private val density = 1.0f
    private fun shown(x: Int, y: Int, size: Int, vw: Int = 1224, vh: Int = 880) = NativePanelCommand("slot", "SHOWN", x, y, size, vw, vh)

    @Test fun `on the AVD the QR covers its slot, where density alone put it left of the panel`() {
        val slot = shown(870, 300, 300)
        val place = InlineQrPlacement.place(slot, 0, 0, webW, webH, density)!!
        assertEquals(1196, place.left); assertEquals(412, place.top); assertEquals(412, place.size)
        // The slot in WebView pixels: its centre and size match the QR's.
        val scale = webW.toDouble() / 1224
        assertEquals((870 + 150) * scale, place.left + place.size / 2.0, 1.0)
        assertEquals((300 + 150) * scale, place.top + place.size / 2.0, 1.0)
        assertEquals(300 * scale, place.size.toDouble(), 1.0)
        // Before: CSS px × density 1.0 = (870, 300, 300), 326 px left and 112 px up from the slot, at 73% of its size.
        val before = Triple((870 * density).toInt(), (300 * density).toInt(), (300 * density).toInt())
        assertNotEquals(Triple(place.left, place.top, place.size), before)
        assertTrue("old left edge is outside the slot", before.first + before.third < place.left + place.size && before.first < place.left - 300)
    }

    @Test fun `the WebView's own offset in the frame is added once`() {
        val place = InlineQrPlacement.place(shown(100, 100, 300, 1000, 800), 40, 25, 1000, 800, 1f)!!
        assertEquals(140, place.left); assertEquals(125, place.top); assertEquals(300, place.size)
    }

    @Test fun `a page whose CSS px equal dp still lands on its slot`() {
        // density 2, dpr 2: the WebView is 2000 px for a 1000 px viewport.
        val place = InlineQrPlacement.place(shown(600, 100, 300, 1000, 600), 0, 0, 2000, 1200, 2f)!!
        assertEquals(1200, place.left); assertEquals(200, place.top); assertEquals(600, place.size)
    }

    @Test fun `scrolling moves the QR with the slot`() {
        val a = InlineQrPlacement.place(shown(870, 300, 300), 0, 0, webW, webH, density)!!
        val b = InlineQrPlacement.place(shown(870, 180, 300), 0, 0, webW, webH, density)!!
        assertEquals(a.left, b.left); assertEquals(a.size, b.size); assertEquals(247, b.top)
    }

    @Test fun `nothing is drawn without a laid out WebView, a viewport, or a SHOWN slot`() {
        assertNull(InlineQrPlacement.place(shown(870, 300, 300), 0, 0, 0, 0, density))
        assertNull(InlineQrPlacement.place(shown(870, 300, 300, vw = 0), 0, 0, webW, webH, density))
        for (kind in listOf("NONE", "HIDDEN")) assertNull(InlineQrPlacement.place(NativePanelCommand("slot", kind, 870, 300, 300, 1224, 880), 0, 0, webW, webH, density))
    }

    @Test fun `a report from another viewport size is not drawn until the page reports again`() {
        // The WebView was resized after the page measured: the two axes no longer give one scale.
        assertNull(InlineQrPlacement.place(shown(870, 300, 300), 0, 0, webW, 900, density))
        // After the page reports for the new viewport it is drawn again.
        assertNotNull(InlineQrPlacement.place(shown(500, 200, 300, 1224, 655), 0, 0, webW, 900, density))
    }

    @Test fun `a slot that would leave the WebView, or a QR too small or too large to scan, is hidden`() {
        assertNull(InlineQrPlacement.place(shown(1000, 300, 300), 0, 0, webW, webH, density))
        assertNull(InlineQrPlacement.place(shown(870, 700, 300), 0, 0, webW, webH, density))
        assertNull("82 dp", InlineQrPlacement.place(shown(870, 300, 60), 0, 0, webW, webH, density))
        assertNull("over 600 dp", InlineQrPlacement.place(shown(0, 0, 870), 0, 0, webW, webH, density))
        assertNotNull("88 CSS px is 121 px here, enough", InlineQrPlacement.place(shown(870, 300, 88), 0, 0, webW, webH, density))
    }
}
