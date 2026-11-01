package io.carscope.app.sync

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout

/** Native sibling of the inspection WebView; no JS bridge or endpoint/credential extras. */
internal class InspectionSyncEntry(private val activity: Activity) {
    private var opening = false
    private val button = Button(activity).apply {
        text = "워셔액 점검 결과 수신 (Debug)"
        tag = "inspection-sync-entry"
        minHeight = 64
        setOnClickListener {
            if (!opening) {
                opening = true; isEnabled = false
                try { activity.startActivity(Intent(activity, SyncReceiverActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
                catch (_: ActivityNotFoundException) { opening = false; isEnabled = true; text = "수신 화면을 열 수 없습니다. Debug 설치를 확인하세요." }
            }
        }
    }
    fun wrap(inspection: View): View = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        addView(inspection, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
    }
    fun resume() { opening = false; button.isEnabled = true }
    fun pause() { button.isEnabled = false }
}
