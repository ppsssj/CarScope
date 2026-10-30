package io.carscope.visualization

import io.carscope.vehicle.DoorId

/**
 * Isometric sedan generated with the Anatomy kit (tools/anatomy-car/build.mjs) plus a plan inset.
 *
 * Contract kept from the P0 schematic: exactly one `<g>` per door with its stable id and
 * `data-state`, whose first `<rect>` is the state chip and whose first `<text>` is the state name.
 * The near-side doors (FRONT_LEFT, REAR_LEFT) are also drawn on the car, open or closed; the
 * right-side doors are hidden by the body at this camera, so they appear in the inset only.
 */
object VehicleSvgRenderer {
    private const val INSET_W = 290

    fun render(diagram: VehicleDiagram): String = buildString {
        val car = AnatomyCarAsset.instance
        val width = car.width + INSET_W
        append("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $width ${car.height}" role="img" aria-labelledby="carscope-title carscope-desc">""")
        append("<title id=\"carscope-title\">${escapeXml("CarScope ${diagram.origin.name} door diagram")}</title>")
        append("<desc id=\"carscope-desc\">${escapeXml(description(diagram))}</desc>")
        val drawn = mutableSetOf<DoorId>()
        for (section in car.sections) {
            when (section) {
                is AnatomyCarAsset.Section.Static -> append(section.markup)
                is AnatomyCarAsset.Section.Door -> {
                    val state = stateOf(diagram, section.door)
                    if (section.open == (state == DoorVisualState.OPEN)) {
                        appendDoor(car.width, section.door, state, section)
                        drawn += section.door
                    }
                }
            }
        }
        appendInset(car.width, car.height, diagram)
        for (door in DoorId.entries) if (door !in drawn) appendDoor(car.width, door, stateOf(diagram, door), null)
        append("</svg>")
    }

    fun partId(door: DoorId): String = when (door) {
        DoorId.FRONT_LEFT -> "door-front-left"
        DoorId.FRONT_RIGHT -> "door-front-right"
        DoorId.REAR_LEFT -> "door-rear-left"
        DoorId.REAR_RIGHT -> "door-rear-right"
    }

    // Public renderer inputs remain closed enums. Escape descriptive text defensively.
    internal fun escapeXml(text: String): String = buildString {
        text.forEach { character ->
            append(when (character) {
                '&' -> "&amp;"
                '<' -> "&lt;"
                '>' -> "&gt;"
                '"' -> "&quot;"
                '\'' -> "&apos;"
                else -> character.toString()
            })
        }
    }

    internal fun colorOf(state: DoorVisualState): String = when (state) {
        DoorVisualState.OPEN -> "#b93817"
        DoorVisualState.CLOSED -> "#14765b"
        DoorVisualState.UNAVAILABLE -> "#636d78"
        DoorVisualState.STALE -> "#856000"
    }

    /** Fill opacity, stroke width and dash pattern: states differ by shape cues, not colour alone. */
    internal fun accentStyle(state: DoorVisualState): String = when (state) {
        DoorVisualState.OPEN -> """fill-opacity="0.30" stroke-width="1.8""""
        DoorVisualState.CLOSED -> """fill-opacity="0.16" stroke-width="1.4""""
        DoorVisualState.UNAVAILABLE -> """fill-opacity="0.32" stroke-width="1.4" stroke-dasharray="4 3""""
        DoorVisualState.STALE -> """fill-opacity="0.26" stroke-width="1.6" stroke-dasharray="1.5 2""""
    }

    private fun stateOf(diagram: VehicleDiagram, door: DoorId) = diagram.doors[door] ?: DoorVisualState.UNAVAILABLE

    private fun StringBuilder.appendDoor(carWidth: Int, door: DoorId, state: DoorVisualState, section: AnatomyCarAsset.Section.Door?) {
        val color = colorOf(state)
        val chip = Inset.chip(carWidth, door)
        append("""<g id="${partId(door)}" data-state="${state.name}">""")
        append("""<rect x="${chip.x}" y="${chip.y}" width="${Inset.CHIP_W}" height="${Inset.CHIP_H}" rx="3" fill="$color" stroke="#233448" stroke-width="1.2"/>""")
        append("""<text x="${chip.labelX}" y="${chip.y + Inset.CHIP_H / 2 + 4}" text-anchor="${chip.anchor}" font-size="12" font-family="sans-serif" fill="#233448">${state.name}</text>""")
        if (section != null) {
            append(section.markup)
            append("""<path d="${section.accent}" fill="$color" stroke="$color" ${accentStyle(state)} stroke-linejoin="round"/>""")
        }
        append("</g>")
    }

    private fun StringBuilder.appendInset(carWidth: Int, height: Int, diagram: VehicleDiagram) {
        val cx = Inset.centre(carWidth)
        append("""<text x="$cx" y="${Inset.TOP - 26}" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#233448">${escapeXml("SOURCE ${diagram.origin.name}")}</text>""")
        append("""<text x="$cx" y="${Inset.TOP - 8}" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#57606a">FRONT</text>""")
        append("""<rect x="${cx - Inset.CAR_W / 2}" y="${Inset.TOP}" width="${Inset.CAR_W}" height="${Inset.CAR_H}" rx="22" fill="#eef1f4" stroke="#233448" stroke-width="1.5"/>""")
        append("""<rect x="${cx - Inset.CAR_W / 2 + 9}" y="${Inset.TOP + 44}" width="${Inset.CAR_W - 18}" height="${Inset.CAR_H - 92}" rx="8" fill="#ffffff" stroke="#8a8a8f"/>""")
        for (door in DoorId.entries) {
            val chip = Inset.chip(carWidth, door)
            val side = if (chip.left) "L" else "R"
            val row = if (door == DoorId.FRONT_LEFT || door == DoorId.FRONT_RIGHT) "F" else "R"
            append("""<text x="${chip.labelX}" y="${chip.y + Inset.CHIP_H / 2 + 18}" text-anchor="${chip.anchor}" font-size="10" font-family="sans-serif" fill="#57606a">$row$side</text>""")
        }
        append("""<text x="$cx" y="${height - 10}" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#57606a">RIGHT DOORS: INSET ONLY</text>""")
    }

    private fun description(diagram: VehicleDiagram): String = DoorId.entries.joinToString("; ") {
        "${it.name}: ${(diagram.doors[it] ?: DoorVisualState.UNAVAILABLE).name}"
    }

    /** Plan-view inset to the right of the car: the four doors in their real positions. */
    internal object Inset {
        const val CHIP_W = 12
        const val CHIP_H = 40
        const val CAR_W = 64
        const val CAR_H = 196
        const val TOP = 92
        private const val GAP = 6

        data class Chip(val x: Int, val y: Int, val left: Boolean, val labelX: Int, val anchor: String)

        fun centre(carWidth: Int) = carWidth + INSET_W / 2

        fun chip(carWidth: Int, door: DoorId): Chip {
            val cx = centre(carWidth)
            val left = door == DoorId.FRONT_LEFT || door == DoorId.REAR_LEFT
            val front = door == DoorId.FRONT_LEFT || door == DoorId.FRONT_RIGHT
            val y = TOP + if (front) 46 else 104
            val x = if (left) cx - CAR_W / 2 - GAP - CHIP_W else cx + CAR_W / 2 + GAP
            val labelX = if (left) x - GAP else x + CHIP_W + GAP
            return Chip(x, y, left, labelX, if (left) "end" else "start")
        }
    }
}

/** Parsed `anatomy-car.parts`: painter-ordered static markup and one section per door pose. */
internal class AnatomyCarAsset private constructor(
    val width: Int,
    val height: Int,
    val sections: List<Section>,
) {
    sealed interface Section {
        data class Static(val markup: String) : Section
        data class Door(val door: DoorId, val open: Boolean, val markup: String, val accent: String) : Section
    }

    companion object {
        const val RESOURCE = "anatomy-car.parts"
        val instance: AnatomyCarAsset by lazy {
            val stream = requireNotNull(AnatomyCarAsset::class.java.getResourceAsStream(RESOURCE)) { "Missing $RESOURCE" }
            parse(stream.bufferedReader(Charsets.UTF_8).use { it.readText() })
        }

        private val doorIds = mapOf(
            "door-front-left" to DoorId.FRONT_LEFT,
            "door-front-right" to DoorId.FRONT_RIGHT,
            "door-rear-left" to DoorId.REAR_LEFT,
            "door-rear-right" to DoorId.REAR_RIGHT,
        )

        internal fun parse(text: String): AnatomyCarAsset {
            val lines = text.lines()
            require(lines.firstOrNull() == "#carscope-anatomy-car 1") { "Unknown asset header" }
            val size = lines.first { it.startsWith("#viewbox ") }.split(' ')
            val sections = mutableListOf<Section>()
            var index = 0
            // Markup lines never start with '@' or '#'; a header owns every line up to the next one.
            fun body(): String = buildString {
                while (index < lines.size && !lines[index].startsWith("@") && !lines[index].startsWith("#")) append(lines[index++])
            }
            while (index < lines.size) {
                val header = lines[index++]
                when {
                    header == "@static" -> sections += Section.Static(body())
                    header.startsWith("@door ") -> {
                        val (_, id, variant) = header.split(' ')
                        require(variant == "open" || variant == "closed") { "Unknown door variant: $variant" }
                        val markup = body()
                        require(lines.getOrNull(index++) == "@accent $id $variant") { "Door section without accent: $header" }
                        sections += Section.Door(requireNotNull(doorIds[id]) { "Unknown door id: $id" }, variant == "open", markup, body())
                    }
                    header.isEmpty() || header.startsWith("#") -> Unit
                    else -> error("Unexpected asset line $index: ${header.take(40)}")
                }
            }
            return AnatomyCarAsset(size[1].toInt(), size[2].toInt(), sections)
        }
    }
}
