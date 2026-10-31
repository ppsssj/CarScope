package io.carscope.vehicle

import io.carscope.visualization.DoorPose
import io.carscope.visualization.DoorVisualState
import io.carscope.visualization.VehicleAssetResolver
import io.carscope.visualization.VehicleDiagram
import io.carscope.visualization.VehicleDiagramMapper
import io.carscope.visualization.VehicleSvgRenderer
import io.carscope.visualization.VehicleVisualAsset
import io.carscope.visualization.VisualAssetResolution
import io.carscope.visualization.VisualProfile
import java.io.StringReader
import java.security.MessageDigest
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.*
import org.junit.Test
import org.w3c.dom.Element
import org.xml.sax.InputSource

/** P2-A8: profile-based drawing selection. Synthetic assets only; no model-derived geometry. */
class VehicleVisualAssetTest {
    private val ioniq = VisualProfile.HYUNDAI_IONIQ5_2022

    /** A tiny closed-only drawing in the format anatomy-svg.mjs writes. */
    private fun syntheticAsset(extraStatic: String = "", header: String = "#visual-profile hyundai-ioniq5-2022\n#door-pose closed-only", tail: String = "") = listOf(
        "#carscope-anatomy-car 1",
        "#viewbox 640 330",
        "#source synthetic-test",
        header,
        "@static",
        """<g id="part-body" data-part="body"><path d="M10 10L300 10L300 200Z" fill="#eef1f4" stroke="#26262a" stroke-width="0.6"/></g>$extraStatic""",
        "@door door-front-left closed",
        """<g id="part-door-front-left" data-part="door-front-left"><path d="M120 120L180 120L180 180Z" fill="#dde2e8" fill-rule="evenodd"/></g>""",
        "@accent door-front-left closed",
        "M120 120L180 120L180 180Z",
        tail,
    ).joinToString("\n").toByteArray()

    private fun parse(xml: String) = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    }.newDocumentBuilder().parse(InputSource(StringReader(xml)))

    private fun door(svg: String, id: DoorId): Element {
        val groups = parse(svg).getElementsByTagName("g")
        return (0 until groups.length).map { groups.item(it) as Element }.single { it.getAttribute("id") == VehicleSvgRenderer.partId(id) }
    }

    private fun sha(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02X".format(it) }
    private fun all(state: DoorVisualState) = VehicleDiagram(DataOrigin.MOCK, DoorId.entries.associateWith { state })
    private val loaded get() = VehicleVisualAsset.parseExternal(ioniq, syntheticAsset())

    @Test fun `default output is byte-identical to the pre-P2-A8 samples`() {
        // SHA-256 of exportSvgSamples on main 00162c5 (before this change); same fixtures as VehicleSvgSamples.
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
        val golden = mapOf(
            "closed" to "48653AC23B2D006B4E13AD9CF5A27AF520695F1B123DEAD63FA81EFF065C77F7",
            "front-left-open" to "5EF068EB2D3753DCF2122A28C031D6F197C4260F93410C1A24EB20952BEE53BE",
            "stale" to "FA4DE2609FECBABB42CBCD27DD2B451B991E34FBD72380DF880F1AE5A58C0549",
            "unavailable" to "70E042AF9A650F01262968BDE4AEF793094D61E743B82C0A3898F703F1F874C8",
        )
        for ((name, diagram) in samples) {
            assertEquals(name, golden.getValue(name), sha(VehicleSvgRenderer.render(diagram)))
            assertEquals(name, VehicleSvgRenderer.render(diagram), VehicleSvgRenderer.render(diagram, VehicleVisualAsset.default))
        }
        assertEquals(VisualProfile.PLEOS_AVD_REFERENCE, VehicleVisualAsset.default.profile)
    }

    @Test fun `profile ids map to profiles and the default is the Pleos reference`() {
        assertEquals(VisualProfile.PLEOS_AVD_REFERENCE, VisualProfile.DEFAULT)
        assertEquals(VisualProfile.PLEOS_AVD_REFERENCE, VisualProfile.fromId("pleos-avd-reference"))
        assertEquals(ioniq, VisualProfile.fromId("hyundai-ioniq5-2022"))
        assertNull(VisualProfile.fromId("Hyundai 42dot Connect 2024"))
        assertNull(VisualProfile.fromId(null))
    }

    @Test fun `resolver loads the default from the bundle and the external profile only from its loader`() {
        val requested = mutableListOf<VisualProfile>()
        val resolver = VehicleAssetResolver { requested += it; syntheticAsset() }
        val default = resolver.resolve(VisualProfile.DEFAULT)
        assertTrue(default is VisualAssetResolution.Loaded)
        assertSame(VehicleVisualAsset.default, default.asset)
        assertTrue("default never reads external files", requested.isEmpty())
        val external = resolver.resolve(ioniq)
        assertTrue(external is VisualAssetResolution.Loaded)
        assertEquals(ioniq, external.asset.profile)
        assertEquals(listOf(ioniq), requested)
    }

    @Test fun `missing, unreadable or invalid assets fall back to the reference with a reason`() {
        fun reason(loader: (VisualProfile) -> ByteArray?) = (VehicleAssetResolver(loader).resolve(ioniq) as VisualAssetResolution.Fallback).also {
            assertSame(VehicleVisualAsset.default, it.asset)
        }.reason
        assertEquals("ASSET_MISSING", reason { null })
        assertTrue(reason { throw java.io.IOException("denied") }.startsWith("ASSET_UNREADABLE"))
        val invalid = mapOf(
            "garbage" to "hello".toByteArray(),
            "empty" to ByteArray(0),
            "oversize" to ByteArray(VehicleVisualAsset.MAX_BYTES + 1) { 'a'.code.toByte() },
            "not utf-8" to byteArrayOf(0xC3.toByte(), 0x28),
            "other profile" to syntheticAsset(header = "#visual-profile pleos-avd-reference\n#door-pose closed-only"),
            "no closed-only declaration" to syntheticAsset(header = "#visual-profile hyundai-ioniq5-2022"),
            "script element" to syntheticAsset(extraStatic = "<script>alert(1)</script>"),
            "event handler" to syntheticAsset(extraStatic = """<path d="M0 0Z" onload="x"/>"""),
            "external url" to syntheticAsset(extraStatic = """<path d="M0 0Z" fill="url(https://example.com/x)"/>"""),
            "text node" to syntheticAsset(extraStatic = "<g>hello</g>"),
            "image element" to syntheticAsset(extraStatic = """<image href="x.png"/>"""),
            "unterminated tag" to syntheticAsset(extraStatic = """<path d="M0 0Z""""),
            "attributes without a space" to syntheticAsset(extraStatic = """<path d="M0 0Z"fill="#fff"/>"""),
            "unquoted value" to syntheticAsset(extraStatic = """<path d=M0/>"""),
            "attribute on a closing tag" to syntheticAsset(extraStatic = """<g></g fill="#fff">"""),
            "fake open pose" to syntheticAsset(tail = "@door door-front-left open\n<g/>\n@accent door-front-left open\nM0 0Z"),
            "accent with markup" to syntheticAsset().toString(Charsets.UTF_8).replace("M120 120L180 120L180 180Z\n", "M0 0Z\"/><script/>\n").let { it.toByteArray() },
        )
        for ((name, bytes) in invalid) assertTrue(name, reason { bytes }.startsWith("ASSET_INVALID"))
    }

    @Test fun `the default profile cannot be replaced by an external file`() {
        assertThrows(IllegalArgumentException::class.java) { VehicleVisualAsset.parseExternal(VisualProfile.DEFAULT, syntheticAsset()) }
    }

    @Test fun `OPEN on a closed-only drawing keeps the state and reports the pose as unavailable`() {
        val svg = VehicleSvgRenderer.render(all(DoorVisualState.OPEN), loaded)
        val fl = door(svg, DoorId.FRONT_LEFT)
        assertEquals("OPEN", fl.getAttribute("data-state"))
        assertEquals("UNAVAILABLE", fl.getAttribute("data-pose"))
        assertTrue("closed shape is drawn, not an open one", svg.contains("M120 120L180 120L180 180Z"))
        assertTrue(svg.contains(VehicleSvgRenderer.OPEN_POSE_NOTE))
        assertTrue(svg.contains("PROFILE hyundai-ioniq5-2022"))
        assertTrue(svg.contains("open shape unavailable"))
        // Chip contract: first text is the reported state.
        assertEquals("OPEN", fl.getElementsByTagName("text").item(0).textContent)
        assertEquals(DoorPose.UNAVAILABLE, VehicleSvgRenderer.doorPose(ioniq, DoorVisualState.OPEN))
        assertEquals(DoorPose.OPEN, VehicleSvgRenderer.doorPose(VisualProfile.DEFAULT, DoorVisualState.OPEN))
    }

    @Test fun `closed, stale and unavailable on a closed-only drawing show no open-pose note`() {
        for (state in listOf(DoorVisualState.CLOSED, DoorVisualState.STALE, DoorVisualState.UNAVAILABLE)) {
            val svg = VehicleSvgRenderer.render(all(state), loaded)
            assertEquals(state.name, door(svg, DoorId.FRONT_LEFT).getAttribute("data-state"))
            assertEquals("CLOSED", door(svg, DoorId.FRONT_LEFT).getAttribute("data-pose"))
            assertFalse(state.name, svg.contains(VehicleSvgRenderer.OPEN_POSE_NOTE))
            val groups = parse(svg).getElementsByTagName("g")
            val ids = (0 until groups.length).map { (groups.item(it) as Element).getAttribute("id") }
            for (id in DoorId.entries) assertEquals("one group for $id", 1, ids.count { it == VehicleSvgRenderer.partId(id) })
        }
    }

    /** Local only: IONIQ5_PARTS=<anatomy-svg.mjs output>/ioniq5.parts. Model-derived data never enters CI. */
    @Test fun `the generated IONIQ 5 asset passes validation when provided locally`() {
        val path = System.getenv("IONIQ5_PARTS")
        org.junit.Assume.assumeTrue("IONIQ5_PARTS not set", path != null && java.io.File(path).isFile)
        val asset = VehicleVisualAsset.parseExternal(ioniq, java.io.File(path!!).readBytes())
        for (state in DoorVisualState.entries) {
            val svg = VehicleSvgRenderer.render(all(state), asset)
            parse(svg)
            assertEquals(if (state == DoorVisualState.OPEN) "UNAVAILABLE" else "CLOSED", door(svg, DoorId.FRONT_LEFT).getAttribute("data-pose"))
        }
    }

    @Test fun `switching profiles leaves nothing of the previous drawing`() {
        val diagram = all(DoorVisualState.OPEN)
        val reference = VehicleSvgRenderer.render(diagram)
        val external = VehicleSvgRenderer.render(diagram, loaded)
        val back = VehicleSvgRenderer.render(diagram, VehicleVisualAsset.default)
        assertEquals(reference, back)
        assertFalse(back.contains("hyundai-ioniq5-2022"))
        assertFalse(back.contains("data-pose"))
        assertFalse(back.contains("M120 120L180 120L180 180Z"))
        assertFalse(external.contains(reference.substringAfter("</desc>").take(200)))
    }
}
