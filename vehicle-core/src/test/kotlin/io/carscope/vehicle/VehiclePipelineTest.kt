package io.carscope.vehicle

import io.carscope.visualization.DoorVisualState
import io.carscope.visualization.VehicleDiagram
import io.carscope.visualization.VehicleDiagramMapper
import io.carscope.visualization.VehicleSvgRenderer
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.*
import org.junit.Test
import org.xml.sax.InputSource

class VehiclePipelineTest {
    private val now = 100_000L

    private fun parseXml(xml: String) = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        setFeature("http://xml.org/sax/features/external-general-entities", false)
        setFeature("http://xml.org/sax/features/external-parameter-entities", false)
    }.newDocumentBuilder().parse(InputSource(StringReader(xml)))

    @Test fun `mock is labelled and timestamps four doors with one clock sample`() {
        var calls = 0
        val source = MockVehicleDataSource { calls++; now }
        val snapshot = source.readSnapshot()
        assertEquals(DataOrigin.MOCK, snapshot.origin)
        assertEquals(1, calls)
        assertEquals(DoorId.entries.toSet(), snapshot.doors.keys)
        assertTrue(snapshot.doors.values.all { it == Reading.Available(DoorPosition.CLOSED, now) })
    }

    @Test fun `open scenario changes only front left and can return to closed`() {
        val source = MockVehicleDataSource { now }
        source.scenario = MockScenario.FRONT_LEFT_OPEN
        val diagram = VehicleDiagramMapper.map(source.readSnapshot(), now)
        assertEquals(DoorVisualState.OPEN, diagram.doors[DoorId.FRONT_LEFT])
        assertEquals(3, diagram.doors.values.count { it == DoorVisualState.CLOSED })
        source.scenario = MockScenario.ALL_CLOSED
        assertTrue(VehicleDiagramMapper.map(source.readSnapshot(), now).doors.values.all { it == DoorVisualState.CLOSED })
    }

    @Test fun `unavailable scenario clears previous successful readings`() {
        val source = MockVehicleDataSource { now }
        source.readSnapshot()
        source.scenario = MockScenario.UNAVAILABLE
        val snapshot = source.readSnapshot()
        assertTrue(snapshot.doors.values.all { it == Reading.Unavailable(UnavailableReason.DISCONNECTED) })
        assertTrue(VehicleDiagramMapper.map(snapshot, now).doors.values.all { it == DoorVisualState.UNAVAILABLE })
    }

    @Test fun `missing keys and unavailable reasons never become closed`() {
        val readings = DoorId.entries.zip(UnavailableReason.entries).associate { (door, reason) ->
            door to Reading.Unavailable(reason)
        }
        for (doors in listOf(emptyMap(), readings)) {
            val diagram = VehicleDiagramMapper.map(VehicleSnapshot(DataOrigin.MOCK, doors), now)
            assertEquals(4, diagram.doors.size)
            assertTrue(diagram.doors.values.all { it == DoorVisualState.UNAVAILABLE })
        }
    }

    @Test fun `age boundary is inclusive and older data becomes stale`() {
        val snapshot = MockVehicleDataSource { now }.readSnapshot()
        assertTrue(VehicleDiagramMapper.map(snapshot, now + 5_000).doors.values.all { it == DoorVisualState.CLOSED })
        assertTrue(VehicleDiagramMapper.map(snapshot, now + 5_001).doors.values.all { it == DoorVisualState.STALE })
    }

    @Test fun `future observation cannot appear current`() {
        val snapshot = MockVehicleDataSource { now + 1 }.readSnapshot()
        assertTrue(VehicleDiagramMapper.map(snapshot, now).doors.values.all { it == DoorVisualState.UNAVAILABLE })
    }

    @Test fun `invalid epoch timestamps cannot overflow into a current reading`() {
        for (observedAt in listOf(-1L, Long.MIN_VALUE)) {
            val snapshot = MockVehicleDataSource { observedAt }.readSnapshot()
            assertTrue(VehicleDiagramMapper.map(snapshot, now).doors.values.all { it == DoorVisualState.UNAVAILABLE })
        }
        val epoch = MockVehicleDataSource { 0L }.readSnapshot()
        assertTrue(VehicleDiagramMapper.map(epoch, -1L).doors.values.all { it == DoorVisualState.UNAVAILABLE })
        assertTrue(VehicleDiagramMapper.map(epoch, Long.MAX_VALUE).doors.values.all { it == DoorVisualState.STALE })
    }

    @Test fun `svg is XML with unique stable ids and state labels`() {
        val source = MockVehicleDataSource { now }.apply { scenario = MockScenario.FRONT_LEFT_OPEN }
        val svg = VehicleSvgRenderer.render(VehicleDiagramMapper.map(source.readSnapshot(), now))
        val document = parseXml(svg)
        assertEquals("svg", document.documentElement.tagName)
        assertEquals("http://www.w3.org/2000/svg", document.documentElement.namespaceURI)
        val groups = document.getElementsByTagName("g")
        assertEquals(4, groups.length)
        val ids = (0 until groups.length).map { groups.item(it).attributes.getNamedItem("id").nodeValue }
        assertEquals(DoorId.entries.map(VehicleSvgRenderer::partId).toSet(), ids.toSet())
        assertTrue(svg.contains("data-state=\"OPEN\""))
        assertTrue(svg.contains("MOCK"))
        assertFalse(svg.contains("<script"))
        assertFalse(svg.contains("<foreignObject"))
    }

    @Test fun `unknown svg contains explicit text and no closed state`() {
        val source = MockVehicleDataSource { now }.apply { scenario = MockScenario.UNAVAILABLE }
        val svg = VehicleSvgRenderer.render(VehicleDiagramMapper.map(source.readSnapshot(), now))
        assertTrue(svg.contains("UNAVAILABLE"))
        assertFalse(svg.contains("CLOSED"))
    }

    @Test fun `origin survives mapping and svg for every supported origin`() {
        for (origin in DataOrigin.entries) {
            // PLEOS here is synthetic model data, not an SDK connection.
            val snapshot = MockVehicleDataSource { now }.readSnapshot().copy(origin = origin)
            val diagram = VehicleDiagramMapper.map(snapshot, now)
            assertEquals(origin, diagram.origin)
            val title = parseXml(VehicleSvgRenderer.render(diagram)).getElementsByTagName("title").item(0).textContent
            assertEquals("CarScope ${origin.name} door diagram", title)
        }
    }

    @Test fun `every unavailable reason and missing door is handled independently`() {
        for (reason in UnavailableReason.entries) {
            for (door in DoorId.entries) {
                val doors = MockVehicleDataSource { now }.readSnapshot().doors.toMutableMap()
                doors[door] = Reading.Unavailable(reason)
                val diagram = VehicleDiagramMapper.map(VehicleSnapshot(DataOrigin.MOCK, doors), now)
                assertEquals(DoorVisualState.UNAVAILABLE, diagram.doors[door])
                assertEquals(3, diagram.doors.values.count { it == DoorVisualState.CLOSED })
                doors.remove(door)
                assertEquals(DoorVisualState.UNAVAILABLE,
                    VehicleDiagramMapper.map(VehicleSnapshot(DataOrigin.MOCK, doors), now).doors[door])
            }
        }
    }

    @Test fun `stale open and closed readings never look fresh`() {
        for (position in DoorPosition.entries) {
            val doors = DoorId.entries.associateWith { Reading.Available(position, now - 5_001) }
            val diagram = VehicleDiagramMapper.map(VehicleSnapshot(DataOrigin.MOCK, doors), now)
            assertTrue(diagram.doors.values.all { it == DoorVisualState.STALE })
        }
    }

    @Test fun `scenario switches do not mutate earlier snapshots`() {
        val source = MockVehicleDataSource { now }
        val closed = source.readSnapshot()
        source.scenario = MockScenario.FRONT_LEFT_OPEN
        source.readSnapshot()
        source.scenario = MockScenario.UNAVAILABLE
        source.readSnapshot()
        assertTrue(closed.doors.values.all { it == Reading.Available(DoorPosition.CLOSED, now) })
    }

    @Test fun `all visual states have distinct svg fill and explicit labels`() {
        val svgs = DoorVisualState.entries.map { state ->
            val diagram = VehicleDiagram(DataOrigin.MOCK, DoorId.entries.associateWith { state })
            val svg = VehicleSvgRenderer.render(diagram)
            val document = parseXml(svg)
            val groups = document.getElementsByTagName("g")
            for (index in 0 until groups.length) {
                val group = groups.item(index) as org.w3c.dom.Element
                assertEquals(state.name, group.getAttribute("data-state"))
                assertEquals(state.name, group.getElementsByTagName("text").item(0).textContent)
            }
            svg
        }
        assertEquals(4, svgs.toSet().size)
        val fills = svgs.map { svg ->
            val group = parseXml(svg).getElementsByTagName("g").item(0) as org.w3c.dom.Element
            (group.getElementsByTagName("rect").item(0) as org.w3c.dom.Element).getAttribute("fill")
        }
        assertEquals(4, fills.toSet().size)
    }

    @Test fun `renderer defaults missing diagram keys to unavailable`() {
        val svg = VehicleSvgRenderer.render(VehicleDiagram(DataOrigin.MOCK, emptyMap()))
        val groups = parseXml(svg).getElementsByTagName("g")
        assertEquals(4, groups.length)
        for (index in 0 until groups.length) {
            assertEquals("UNAVAILABLE", (groups.item(index) as org.w3c.dom.Element).getAttribute("data-state"))
        }
        assertFalse(svg.contains("CLOSED"))
    }

    @Test fun `XML escaping preserves text and cannot inject elements or attributes`() {
        val original = "도어 & <script> \"quoted\" 'single' &amp;"
        val escaped = VehicleSvgRenderer.escapeXml(original)
        val document = parseXml("<text label=\"$escaped\">$escaped</text>")
        assertEquals(original, document.documentElement.textContent)
        assertEquals(original, document.documentElement.getAttribute("label"))
        assertEquals(0, document.getElementsByTagName("script").length)
        assertEquals("", VehicleSvgRenderer.escapeXml(""))
    }

    @Test fun `mock clock exceptions are not disguised as valid data`() {
        val failure = IllegalStateException("clock failed")
        val source = MockVehicleDataSource { throw failure }
        try {
            source.readSnapshot()
            fail("Expected clock error")
        } catch (actual: IllegalStateException) {
            assertSame(failure, actual)
        }
    }
}
