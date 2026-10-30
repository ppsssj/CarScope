package io.carscope.vehicle

import io.carscope.visualization.VehicleDiagramMapper
import io.carscope.visualization.VehicleSvgRenderer
import java.io.File

/** Synthetic fixtures, including stale data without changing its observation timestamp. */
object VehicleSvgSamples {
    @JvmStatic
    fun main(args: Array<String>) {
        require(args.size == 1) { "Expected output directory" }
        val output = File(args.single()).apply { mkdirs() }
        val now = 100_000L
        val source = MockVehicleDataSource { now }
        val closed = source.readSnapshot()
        val samples = linkedMapOf(
            "closed" to VehicleDiagramMapper.map(closed, now),
            "stale" to VehicleDiagramMapper.map(closed, now + 5_001),
        )
        source.scenario = MockScenario.FRONT_LEFT_OPEN
        samples["front-left-open"] = VehicleDiagramMapper.map(source.readSnapshot(), now)
        source.scenario = MockScenario.UNAVAILABLE
        samples["unavailable"] = VehicleDiagramMapper.map(source.readSnapshot(), now)
        samples.forEach { (name, diagram) ->
            val file = File(output, "$name.svg")
            file.writeText(VehicleSvgRenderer.render(diagram), Charsets.UTF_8)
            println("SVG_SAMPLE=${file.absolutePath}")
        }
    }
}
