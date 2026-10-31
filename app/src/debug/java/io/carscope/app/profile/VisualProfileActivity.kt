package io.carscope.app.profile

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.webkit.WebView
import io.carscope.app.MainActivity
import io.carscope.vehicle.DataOrigin
import io.carscope.vehicle.DoorId
import io.carscope.visualization.DoorPose
import io.carscope.visualization.DoorVisualState
import io.carscope.visualization.VehicleAssetResolver
import io.carscope.visualization.VehicleDiagram
import io.carscope.visualization.VehicleSvgRenderer
import io.carscope.visualization.VehicleVisualAsset
import io.carscope.visualization.VisualAssetResolution
import io.carscope.visualization.VisualProfile
import java.util.Locale
import java.util.concurrent.atomic.AtomicLong

/**
 * Debug-only (P2-A8): the main screen with an explicitly selected visual profile. Not in release
 * builds and not reachable from the launcher; started with adb:
 *
 *   adb shell am start -n io.carscope.app/.profile.VisualProfileActivity --es profile hyundai-ioniq5-2022
 *
 * The non-default drawing is read only from this app's private files directory
 * (`files/debug-visual-assets/<profile>.parts`), which adb can fill with `run-as` on a debuggable
 * build only. No storage permission, no network, no JavaScript. A missing or invalid file shows the
 * bundled reference drawing and says why; the vehicle data source is unaffected by the profile.
 *
 * Optional extras for measurements (logcat tag CarScopeProfile): `bench` = render/parse repetitions,
 * `repaint` = forced WebView reloads, each timed to the WebView visual-state callback.
 */
class VisualProfileActivity : MainActivity() {
    private var asset: VehicleVisualAsset = VehicleVisualAsset.default
    private var status = ""
    private var requestedId: String? = null
    private val created = SystemClock.elapsedRealtimeNanos()
    private var firstVisibleLogged = false
    private var repaintsLeft = 0
    private val request = AtomicLong()

    override fun onCreate(savedInstanceState: Bundle?) {
        select(intent, "create")
        repaintsLeft = intent.getIntExtra("repaint", 0)
        super.onCreate(savedInstanceState)
        intent.getIntExtra("bench", 0).takeIf { it > 0 }?.let(::bench)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val started = SystemClock.elapsedRealtimeNanos()
        select(intent, "switch")
        switchStarted = started
        repaintsLeft = intent.getIntExtra("repaint", 0)
        redrawDiagram()
        intent.getIntExtra("bench", 0).takeIf { it > 0 }?.let(::bench)
    }

    private var switchStarted = 0L

    private fun select(intent: Intent, reason: String) {
        val t0 = SystemClock.elapsedRealtimeNanos()
        requestedId = intent.getStringExtra(EXTRA_PROFILE)
        val requested = VisualProfile.fromId(requestedId ?: VisualProfile.DEFAULT.id)
        if (requested == null) {
            asset = VehicleVisualAsset.default
            status = "VISUAL PROFILE $requestedId UNKNOWN → FALLBACK ${VisualProfile.DEFAULT.id}"
            log("resolve", "\"requested\":\"$requestedId\",\"outcome\":\"UNKNOWN_PROFILE\"")
            return
        }
        val resolution = VehicleAssetResolver(::readDebugAsset).resolve(requested)
        asset = resolution.asset
        val ms = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6
        status = when (resolution) {
            is VisualAssetResolution.Loaded -> "VISUAL PROFILE ${asset.profile.id}" +
                if (asset.profile == VisualProfile.DEFAULT) " (bundled)" else " (DEBUG external asset ${asset.sha256.take(12)}, not for distribution)"
            is VisualAssetResolution.Fallback -> "VISUAL PROFILE ${requested.id} → FALLBACK ${VisualProfile.DEFAULT.id} (${resolution.reason})"
        }
        val outcome = if (resolution is VisualAssetResolution.Fallback) "FALLBACK" else "LOADED"
        val why = (resolution as? VisualAssetResolution.Fallback)?.reason?.replace("\"", "'") ?: ""
        log("resolve", "\"when\":\"$reason\",\"requested\":\"${requested.id}\",\"outcome\":\"$outcome\",\"reason\":\"$why\",\"profile\":\"${asset.profile.id}\",\"sha256\":\"${asset.sha256}\",\"bytes\":${asset.bytes},\"readParseMs\":${fmt2(ms)}")
    }

    private fun readDebugAsset(profile: VisualProfile): ByteArray? = DebugVisualAssetStore(filesDir).read(profile)

    override fun visualAsset(): VehicleVisualAsset = asset

    override fun visualStatus(diagram: VehicleDiagram): String = buildString {
        append(status)
        for (door in DoorId.entries) {
            val state = diagram.doors[door] ?: DoorVisualState.UNAVAILABLE
            if (VehicleSvgRenderer.doorPose(asset.profile, state) == DoorPose.UNAVAILABLE) append("\n${door.name}: ${VehicleSvgRenderer.OPEN_POSE_NOTE}")
        }
    }

    override fun onDiagramLoaded(view: WebView, svg: String, renderNanos: Long) {
        val loaded = SystemClock.elapsedRealtimeNanos()
        val id = request.incrementAndGet()
        val switchFrom = switchStarted.also { switchStarted = 0L }
        view.postVisualStateCallback(id, object : WebView.VisualStateCallback() {
            override fun onComplete(requestId: Long) {
                val now = SystemClock.elapsedRealtimeNanos()
                val extra = buildString {
                    if (!firstVisibleLogged) append(",\"createToVisibleMs\":${fmt1((now - created) / 1e6)}")
                    if (switchFrom != 0L) append(",\"switchToVisibleMs\":${fmt1((now - switchFrom) / 1e6)}")
                }
                firstVisibleLogged = true
                log("visible", "\"profile\":\"${asset.profile.id}\",\"svgBytes\":${svg.length},\"renderMs\":${fmt2(renderNanos / 1e6)},\"loadToVisibleMs\":${fmt1((now - loaded) / 1e6)}$extra")
                if (repaintsLeft > 0) {
                    repaintsLeft--
                    view.post { redrawDiagram() }
                }
            }
        })
    }

    /** Render and parse timings off the UI thread; inputs are synthetic diagrams, not vehicle data. */
    private fun bench(n: Int) {
        val current = asset
        Thread {
            val render = DoubleArray(n * DoorVisualState.entries.size)
            var k = 0
            repeat(n) {
                for (state in DoorVisualState.entries) {
                    val diagram = VehicleDiagram(DataOrigin.MOCK, DoorId.entries.associateWith { state })
                    val t0 = System.nanoTime()
                    VehicleSvgRenderer.render(diagram, current)
                    render[k++] = (System.nanoTime() - t0) / 1e6
                }
            }
            val parse = if (current.profile == VisualProfile.DEFAULT) null else readDebugAsset(current.profile)?.let { bytes ->
                DoubleArray(n) {
                    val t0 = System.nanoTime()
                    VehicleVisualAsset.parseExternal(current.profile, bytes)
                    (System.nanoTime() - t0) / 1e6
                }
            }
            log("bench", "\"profile\":\"${current.profile.id}\",\"n\":$n,\"render\":${stats(render)},\"parse\":${parse?.let(::stats) ?: "null"}")
        }.start()
    }

    private fun stats(values: DoubleArray): String {
        val s = values.sorted()
        fun q(p: Double) = s[((s.size - 1) * p).toInt()]
        return "{\"count\":${s.size},\"p50\":${fmt3(q(0.5))},\"p95\":${fmt3(q(0.95))},\"max\":${fmt3(s.last())}}"
    }

    private fun fmt1(value: Double) = String.format(Locale.ROOT, "%.1f", value)
    private fun fmt2(value: Double) = String.format(Locale.ROOT, "%.2f", value)
    private fun fmt3(value: Double) = String.format(Locale.ROOT, "%.3f", value)

    private fun log(event: String, body: String) = Log.i(TAG, "{\"event\":\"$event\",$body}")

    companion object {
        const val EXTRA_PROFILE = "profile"
        private const val TAG = "CarScopeProfile"
    }
}
