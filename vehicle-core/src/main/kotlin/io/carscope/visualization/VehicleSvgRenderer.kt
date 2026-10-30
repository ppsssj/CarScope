package io.carscope.visualization

import io.carscope.vehicle.DoorId

/** Original P0 schematic, not an Anatomy-generated asset. IDs are the future asset contract. */
object VehicleSvgRenderer {
    fun render(diagram: VehicleDiagram): String = buildString {
        append("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 300" role="img" aria-labelledby="carscope-title carscope-desc">""")
        append("<title id=\"carscope-title\">${escapeXml("CarScope ${diagram.origin.name} door diagram")}</title>")
        append("<desc id=\"carscope-desc\">${escapeXml(description(diagram))}</desc>")
        append("""<rect x="160" y="20" width="200" height="260" rx="45" fill="#d9e2ea" stroke="#233448" stroke-width="3"/>""")
        append("""<rect x="197" y="65" width="126" height="165" rx="20" fill="#ffffff" stroke="#233448"/>""")
        append("""<text x="260" y="49" text-anchor="middle" font-size="18">FRONT</text>""")
        for (door in DoorId.entries) {
            val state = diagram.doors[door] ?: DoorVisualState.UNAVAILABLE
            val left = door == DoorId.FRONT_LEFT || door == DoorId.REAR_LEFT
            val front = door == DoorId.FRONT_LEFT || door == DoorId.FRONT_RIGHT
            val x = if (left) 145 else 340
            val y = if (front) 85 else 165
            val color = when (state) {
                DoorVisualState.OPEN -> "#b93817"
                DoorVisualState.CLOSED -> "#14765b"
                DoorVisualState.UNAVAILABLE -> "#636d78"
                DoorVisualState.STALE -> "#856000"
            }
            append("""<g id="${partId(door)}" data-state="${state.name}">""")
            append("""<rect x="$x" y="$y" width="35" height="65" rx="6" fill="$color" stroke="#233448" stroke-width="2"/>""")
            append("""<text x="${if (left) 135 else 385}" y="${y + 36}" text-anchor="${if (left) "end" else "start"}" font-size="13" fill="#233448">${state.name}</text></g>""")
        }
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

    private fun description(diagram: VehicleDiagram): String = DoorId.entries.joinToString("; ") {
        "${it.name}: ${(diagram.doors[it] ?: DoorVisualState.UNAVAILABLE).name}"
    }
}
