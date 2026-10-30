package io.carscope.vehicle

import io.carscope.visualization.VehicleDiagram
import io.carscope.visualization.VehicleSvgRenderer
import io.carscope.visualization.DoorVisualState
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.*
import org.junit.Test
import org.w3c.dom.Element
import org.xml.sax.InputSource

/** The Anatomy-based renderer: structure, state mapping, safety and bounds. Pure JVM. */
class VehicleSvgRendererTest {
    private fun parse(xml: String) = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    }.newDocumentBuilder().parse(InputSource(StringReader(xml)))

    private fun render(states: Map<DoorId, DoorVisualState>, origin: DataOrigin = DataOrigin.MOCK) =
        VehicleSvgRenderer.render(VehicleDiagram(origin, states))

    private fun all(state: DoorVisualState) = DoorId.entries.associateWith { state }

    private fun group(svg: String, door: DoorId): Element {
        val groups = parse(svg).getElementsByTagName("g")
        return (0 until groups.length).map { groups.item(it) as Element }.single { it.getAttribute("id") == VehicleSvgRenderer.partId(door) }
    }

    private fun pathsIn(element: Element) = element.getElementsByTagName("path").length

    @Test fun `every state combination is valid XML with one group per door id`() {
        for (front in DoorVisualState.entries) for (rear in DoorVisualState.entries) {
            val svg = render(mapOf(DoorId.FRONT_LEFT to front, DoorId.REAR_LEFT to rear, DoorId.FRONT_RIGHT to rear, DoorId.REAR_RIGHT to front))
            val document = parse(svg)
            val ids = (0 until document.getElementsByTagName("g").length).map { (document.getElementsByTagName("g").item(it) as Element).getAttribute("id") }
            assertEquals(4, ids.size)
            assertEquals(DoorId.entries.map(VehicleSvgRenderer::partId).toSet(), ids.toSet())
            assertEquals(front.name, group(svg, DoorId.FRONT_LEFT).getAttribute("data-state"))
            assertEquals(rear.name, group(svg, DoorId.REAR_LEFT).getAttribute("data-state"))
        }
    }

    @Test fun `open uses the open pose and every other state the closed pose`() {
        val closed = group(render(all(DoorVisualState.CLOSED)), DoorId.FRONT_LEFT)
        val open = group(render(all(DoorVisualState.OPEN)), DoorId.FRONT_LEFT)
        val closedArt = (0 until closed.getElementsByTagName("path").length).map { (closed.getElementsByTagName("path").item(it) as Element).getAttribute("d") }
        val openArt = (0 until open.getElementsByTagName("path").length).map { (open.getElementsByTagName("path").item(it) as Element).getAttribute("d") }
        assertNotEquals(closedArt, openArt)
        for (state in listOf(DoorVisualState.UNAVAILABLE, DoorVisualState.STALE)) {
            val other = group(render(all(state)), DoorId.FRONT_LEFT)
            val art = (0 until other.getElementsByTagName("path").length).map { (other.getElementsByTagName("path").item(it) as Element).getAttribute("d") }
            assertEquals("$state draws the closed door", closedArt, art)
        }
    }

    @Test fun `near doors are drawn on the car and right doors only in the inset`() {
        val svg = render(all(DoorVisualState.OPEN))
        assertTrue(pathsIn(group(svg, DoorId.FRONT_LEFT)) > 10)
        assertTrue(pathsIn(group(svg, DoorId.REAR_LEFT)) > 10)
        assertEquals(0, pathsIn(group(svg, DoorId.FRONT_RIGHT)))
        assertEquals(0, pathsIn(group(svg, DoorId.REAR_RIGHT)))
        assertTrue(svg.contains("RIGHT DOORS: INSET ONLY"))
    }

    @Test fun `state colour and dash pattern differ for every state`() {
        val accents = DoorVisualState.entries.map { state ->
            val door = group(render(all(state)), DoorId.FRONT_LEFT)
            val paths = door.getElementsByTagName("path")
            val accent = paths.item(paths.length - 1) as Element
            assertEquals(VehicleSvgRenderer.colorOf(state), accent.getAttribute("stroke"))
            assertEquals(VehicleSvgRenderer.colorOf(state), (door.getElementsByTagName("rect").item(0) as Element).getAttribute("fill"))
            accent.getAttribute("stroke") + accent.getAttribute("stroke-dasharray")
        }
        assertEquals(4, accents.toSet().size)
        val dashed = DoorVisualState.entries.filter { state ->
            val paths = group(render(all(state)), DoorId.FRONT_LEFT).getElementsByTagName("path")
            (paths.item(paths.length - 1) as Element).hasAttribute("stroke-dasharray")
        }
        assertEquals(listOf(DoorVisualState.UNAVAILABLE, DoorVisualState.STALE), dashed)
    }

    @Test fun `data origin is shown in title and inset`() {
        for (origin in DataOrigin.entries) {
            val document = parse(render(all(DoorVisualState.CLOSED), origin))
            assertEquals("CarScope ${origin.name} door diagram", document.getElementsByTagName("title").item(0).textContent)
            val texts = (0 until document.getElementsByTagName("text").length).map { document.getElementsByTagName("text").item(it).textContent }
            assertTrue(texts.contains("SOURCE ${origin.name}"))
        }
    }

    @Test fun `svg is self-contained static markup`() {
        val svg = render(all(DoorVisualState.OPEN))
        for (forbidden in listOf("<script", "<foreignObject", "href", "url(", "<image", "<style", "@import", "javascript:", "<animate", "<set ", "filter=")) {
            assertFalse("found $forbidden", svg.contains(forbidden, ignoreCase = true))
        }
        assertEquals(1, Regex("http").findAll(svg).count()) // only the SVG namespace
        assertFalse(render(all(DoorVisualState.UNAVAILABLE)).contains("CLOSED"))
    }

    @Test fun `every drawn coordinate lies inside the view box`() {
        val svg = render(all(DoorVisualState.OPEN))
        val root = parse(svg).documentElement
        val (_, _, width, height) = root.getAttribute("viewBox").split(' ').map { it.toDouble() }
        val paths = root.getElementsByTagName("path")
        var points = 0
        for (index in 0 until paths.length) {
            val d = (paths.item(index) as Element).getAttribute("d")
            assertTrue("only absolute M/L/Z commands", d.all { it.isDigit() || it in "MLZ.- ," })
            val numbers = Regex("-?\\d+(\\.\\d+)?").findAll(d).map { it.value.toDouble() }.toList()
            numbers.chunked(2).forEach { (x, y) ->
                assertTrue("x=$x outside 0..$width", x in 0.0..width)
                assertTrue("y=$y outside 0..$height", y in 0.0..height)
                points++
            }
        }
        assertTrue(points > 1000)
    }
}
