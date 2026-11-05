package io.carscope.app.lab

/**
 * Where the Native receiver panel sits over the 3D page. A wide window keeps the vehicle and the page toast visible
 * beside a right side panel. A narrow one gets a centered panel, started below the toast (top 72 CSS px plus its height).
 */
internal data class ReceiverOverlayPlacement(val side: Boolean, val widthDp: Int, val heightDp: Int?, val topDp: Int)

private const val SIDE_MIN_WINDOW_DP = 840
private const val SIDE_MIN_DP = 380
private const val SIDE_MAX_DP = 520
private const val CENTER_MAX_DP = 560
private const val CENTER_MARGIN_DP = 16
private const val TOAST_CLEARANCE_DP = 120

internal fun receiverOverlayPlacement(windowWidthDp: Int, windowHeightDp: Int): ReceiverOverlayPlacement =
    if (windowWidthDp >= SIDE_MIN_WINDOW_DP && windowWidthDp > windowHeightDp) {
        ReceiverOverlayPlacement(true, (windowWidthDp * 34 / 100).coerceIn(SIDE_MIN_DP, SIDE_MAX_DP), null, 0)
    } else {
        ReceiverOverlayPlacement(false,
            (windowWidthDp - 2 * CENTER_MARGIN_DP).coerceIn(1, CENTER_MAX_DP),
            (windowHeightDp - TOAST_CLEARANCE_DP - CENTER_MARGIN_DP).coerceAtLeast(1),
            TOAST_CLEARANCE_DP)
    }
