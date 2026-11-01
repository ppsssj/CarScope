package io.carscope.app.sync

import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

internal object SyncQrRenderer {
    fun bitmap(payload: SyncQrPayload, size: Int = 512): Bitmap {
        require(size in 256..1024 && payload.value.length <= 2048)
        val matrix = QRCodeWriter().encode(payload.value, BarcodeFormat.QR_CODE, size, size,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 4))
        val pixels = IntArray(size * size) { i -> if (matrix[i % size, i / size]) -0x1000000 else -1 }
        return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
    }
}
