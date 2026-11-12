package io.carscope.app.lab

import io.carscope.app.sync.NativePanelCommand
import kotlin.math.abs
import kotlin.math.roundToInt

/** Pixels of the FrameLayout that holds both the WebView and the inline QR. */
internal data class QrPlacement(val left: Int, val top: Int, val size: Int, val scale: Double)

/**
 * The one conversion from the page's QR slot to Native pixels.
 *
 * The page reports the slot in CSS px of its own viewport, with that viewport's size (vw, vh). The scale is measured, not
 * assumed: the WebView's laid-out width over vw. `displayMetrics.density` is not the WebView's CSS-to-pixel ratio (on the
 * Pleos AVD density is 1.0 while the page's devicePixelRatio is 1.375), so multiplying by it put the QR left of its slot.
 * Density is used only for the scannable-size bound, which is a physical size.
 */
internal object InlineQrPlacement {
    const val MIN_QR_DP = 120
    const val MAX_QR_DP = 600
    /** Allowed disagreement between the horizontal and vertical scale before the report is treated as stale. */
    private const val AXIS_TOLERANCE = 0.02

    fun place(command: NativePanelCommand, webLeft: Int, webTop: Int, webWidth: Int, webHeight: Int, density: Float): QrPlacement? {
        if (command.slot != "SHOWN" || command.size <= 0 || command.vw <= 0 || command.vh <= 0) return null
        if (webWidth <= 0 || webHeight <= 0 || density <= 0f) return null
        val scale = webWidth.toDouble() / command.vw
        // Both axes must give one scale. If not, the page measured a viewport the WebView no longer has (mid-resize):
        // hide until the page reports again instead of drawing at a mixed position.
        if (abs(webHeight.toDouble() / command.vh - scale) > scale * AXIS_TOLERANCE) return null
        val left = (command.x * scale).roundToInt(); val top = (command.y * scale).roundToInt(); val size = (command.size * scale).roundToInt()
        if (left < 0 || top < 0 || left + size > webWidth || top + size > webHeight) return null
        if (size / density < MIN_QR_DP || size / density > MAX_QR_DP) return null
        return QrPlacement(webLeft + left, webTop + top, size, scale)
    }
}
