package io.carscope.app

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.carscope.vehicle.DoorId
import io.carscope.vehicle.Reading
import io.carscope.vehicle.MockScenario
import io.carscope.vehicle.MockVehicleDataSource
import io.carscope.vehicle.VehicleDataSource
import io.carscope.vehicle.VehicleSnapshot
import io.carscope.app.pleos.PleosVehicleDataSource
import io.carscope.app.pleos.SdkDoorSession
import io.carscope.visualization.VehicleDiagram
import io.carscope.visualization.VehicleDiagramMapper
import io.carscope.visualization.VehicleSvgRenderer
import io.carscope.visualization.VehicleVisualAsset
import java.time.Instant

/**
 * Main screen. The drawing always comes from [visualAsset]; release builds use the bundled reference.
 * The protected hooks exist so a debug-only subclass (src/debug) can select another visual profile
 * and record timings; their defaults do nothing and change no output.
 */
open class MainActivity : Activity() {
    private val mockSource = MockVehicleDataSource()
    private lateinit var pleosSource: PleosVehicleDataSource
    private var usePleos = false
    private var started = false
    private val vehicleDataSource: VehicleDataSource get() = if (usePleos) pleosSource else mockSource
    private lateinit var notice: TextView
    private lateinit var summary: TextView
    private lateinit var webViewStatus: TextView
    private var diagramView: WebView? = null
    private var lastSnapshot: VehicleSnapshot? = null
    private var lastSvg: String? = null
    private val refreshHandler = Handler(Looper.getMainLooper())
    private val refreshDisplay = object : Runnable {
        override fun run() {
            // Re-evaluate age without inventing a new vehicle observation.
            renderSnapshot()
            refreshHandler.postDelayed(this, 1_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        usePleos = savedInstanceState?.getBoolean("pleos") ?: false
        pleosSource = PleosVehicleDataSource(
            factory = { SdkDoorSession(applicationContext) },
            log = { Log.i("CarScopeDoor", it) },
        )
        mockSource.scenario = MockScenario.entries.firstOrNull {
            it.name == savedInstanceState?.getString("scenario")
        } ?: MockScenario.ALL_CLOSED

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(16), dp(24), dp(16))
        }
        setContentView(ScrollView(this).apply { addView(column) })
        notice = TextView(this).apply { textSize = 24f }
        column.addView(notice)
        column.addView(LinearLayout(this).apply {
            listOf(R.string.source_mock to false, R.string.source_pleos to true).forEach { (label, real) ->
                addView(Button(this@MainActivity).apply {
                    setText(label)
                    minHeight = dp(48)
                    setOnClickListener { selectSource(real) }
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            }
        })
        summary = TextView(this).apply { textSize = 18f }
        column.addView(summary)
        webViewStatus = TextView(this)
        column.addView(webViewStatus)
        attachDiagram(column)

        listOf(
            R.string.scenario_closed to MockScenario.ALL_CLOSED,
            R.string.scenario_open to MockScenario.FRONT_LEFT_OPEN,
            R.string.scenario_unavailable to MockScenario.UNAVAILABLE,
        ).forEach { (label, scenario) ->
            column.addView(Button(this).apply {
                setText(label)
                minHeight = dp(48)
                setOnClickListener {
                    mockSource.scenario = scenario
                    selectSource(false)
                    renderSnapshot(readNewSnapshot = true)
                }
            })
        }
        renderSnapshot(readNewSnapshot = true)
    }

    private fun selectSource(real: Boolean) {
        if (usePleos != real) {
            if (usePleos) pleosSource.stop()
            usePleos = real
            lastSnapshot = null
        }
        if (usePleos && started) pleosSource.start()
        renderSnapshot(readNewSnapshot = true)
    }

    private fun attachDiagram(column: LinearLayout) {
        try {
            val provider = WebView.getCurrentWebViewPackage()
            if (provider == null) {
                webViewStatus.setText(R.string.webview_not_available)
                return
            }
            webViewStatus.text = getString(R.string.webview_provider, provider.packageName, provider.versionName)
            val view = WebView(this)
            diagramView = view
            view.settings.apply {
                javaScriptEnabled = false
                allowFileAccess = false
                allowContentAccess = false
                blockNetworkLoads = true
                domStorageEnabled = false
            }
            view.webViewClient = object : WebViewClient() {
                private var loadFailed = false

                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    loadFailed = false
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

                override fun onPageFinished(view: WebView, url: String) {
                    // A completed load is not proof that SVG painted correctly.
                    if (!loadFailed) {
                        webViewStatus.text = getString(R.string.webview_provider, provider.packageName, provider.versionName) +
                            "\n" + getString(R.string.webview_loaded)
                    }
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) {
                        loadFailed = true
                        webViewStatus.setText(R.string.webview_error)
                    }
                }
            }
            // The Anatomy sedan plus its plan inset is about 2.8:1; 320dp keeps the car legible.
            column.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(320)))
        } catch (_: RuntimeException) {
            diagramView?.let { view ->
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
            }
            diagramView = null
            webViewStatus.setText(R.string.webview_error)
        }
    }

    private fun renderSnapshot(readNewSnapshot: Boolean = false) {
        val snapshot = if (readNewSnapshot || usePleos) vehicleDataSource.readSnapshot() else
            lastSnapshot ?: vehicleDataSource.readSnapshot()
        lastSnapshot = snapshot
        val now = System.currentTimeMillis()
        val diagram = VehicleDiagramMapper.map(snapshot, now)
        notice.setText(if (usePleos) R.string.pleos_notice else R.string.mock_notice)
        summary.text = buildString {
            appendLine(getString(R.string.data_origin, snapshot.origin.name))
            appendLine(getString(R.string.snapshot_time, Instant.ofEpochMilli(now).toString()))
            DoorId.entries.forEach { door ->
                val reason = (snapshot.doors[door] as? Reading.Unavailable)?.reason
                appendLine("${door.name}: ${diagram.doors.getValue(door).name}${reason?.let { " ($it)" } ?: ""}")
            }
            if (usePleos) appendLine(pleosSource.status)
            visualStatus(diagram)?.let { appendLine(it) }
        }
        val renderStarted = System.nanoTime()
        val svg = VehicleSvgRenderer.render(diagram, visualAsset())
        val renderNanos = System.nanoTime() - renderStarted
        // Self-contained, typed SVG. No scripts, bridge, network assets, or untrusted text.
        // Give SVG both viewport dimensions so its viewBox fits inside the fixed-height WebView.
        val html = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>CarScope ${snapshot.origin.name}</title><style>html,body{margin:0;inline-size:100%;block-size:100%}svg{display:block;inline-size:100%;block-size:100%}</style></head><body>$svg</body></html>"""
        if (svg != lastSvg) {
            diagramView?.let { view ->
                view.loadDataWithBaseURL("https://carscope.invalid/", html, "text/html", "UTF-8", null)
                onDiagramLoaded(view, svg, renderNanos)
            }
            lastSvg = svg
        }
    }

    /** Drawing for the diagram. Release: always the bundled reference profile. */
    protected open fun visualAsset(): VehicleVisualAsset = VehicleVisualAsset.default

    /** Extra summary line describing the drawing, or null (release). */
    protected open fun visualStatus(diagram: VehicleDiagram): String? = null

    /** Called after a new SVG was handed to the WebView. */
    protected open fun onDiagramLoaded(view: WebView, svg: String, renderNanos: Long) = Unit

    /** Draw again even if the SVG text did not change (e.g. after the drawing was replaced). */
    protected fun redrawDiagram() {
        lastSvg = null
        renderSnapshot()
    }

    override fun onStart() {
        super.onStart()
        started = true
        if (usePleos) pleosSource.start()
        refreshHandler.post(refreshDisplay)
    }

    override fun onStop() {
        started = false
        pleosSource.stop()
        refreshHandler.removeCallbacks(refreshDisplay)
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("scenario", mockSource.scenario.name)
        outState.putBoolean("pleos", usePleos)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        pleosSource.close()
        refreshHandler.removeCallbacks(refreshDisplay)
        diagramView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        diagramView = null
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
