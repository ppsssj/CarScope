package io.carscope.app.sync

/** Authenticated creation-response clock only. HTTP Date/device wall clock are deliberately not substitutes. */
internal class SyncServerClock private constructor(val upperAtReceipt: Long, val receiptElapsed: Long) {
    fun upperNow(elapsed: Long): Long? = if (elapsed >= receiptElapsed) upperAtReceipt + elapsed - receiptElapsed else null
    companion object {
        const val NATIVE_QUEUE_BUDGET_MS = 2000L
        const val DELIVERY_BUDGET_MS = 4000L
        fun fromResponse(serverNow: Long, started: Long, ended: Long): SyncServerClock? {
            if (serverNow !in 0..8_640_000_000_000_000L || started < 0 || ended < started || ended - started > 5000) return null
            // Server captures serverNow while serializing creation, in the same clock domain as expiry/proof.
            return SyncServerClock(serverNow + ended - started, ended)
        }
    }
}
