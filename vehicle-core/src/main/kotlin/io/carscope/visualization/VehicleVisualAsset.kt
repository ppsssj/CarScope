package io.carscope.visualization

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

/**
 * Which drawing is shown. A visual profile is chosen explicitly; it is never inferred from the
 * vehicle data source or its reported make/model (the Pleos AVD reports "Hyundai 42dot / Connect /
 * 2024", which is not an IONIQ 5). Ids match tools/ioniq5-asset/profile.mjs.
 */
enum class VisualProfile(val id: String, val doorPose: DoorPoseSupport) {
    /** Bundled Anatomy reference drawing; the product default. */
    PLEOS_AVD_REFERENCE("pleos-avd-reference", DoorPoseSupport.OPEN_AND_CLOSED),

    /** OpenX community model (P2-A7). Debug-only external asset: never bundled, no open door shape. */
    HYUNDAI_IONIQ5_2022("hyundai-ioniq5-2022", DoorPoseSupport.CLOSED_ONLY);

    companion object {
        val DEFAULT = PLEOS_AVD_REFERENCE
        fun fromId(id: String?): VisualProfile? = entries.firstOrNull { it.id == id }
    }
}

/** Door shapes a drawing contains. */
enum class DoorPoseSupport { OPEN_AND_CLOSED, CLOSED_ONLY }

/** Shape drawn for one door. UNAVAILABLE: the door is reported OPEN but the drawing has no open shape. */
enum class DoorPose { CLOSED, OPEN, UNAVAILABLE }

class InvalidVisualAssetException(message: String) : IllegalArgumentException(message)

/** A parsed, validated car drawing bound to one visual profile. */
class VehicleVisualAsset private constructor(
    val profile: VisualProfile,
    internal val car: AnatomyCarAsset,
    val sha256: String,
    val bytes: Int,
) {
    companion object {
        const val MAX_BYTES = 2_000_000

        /** The bundled reference drawing (`anatomy-car.parts`), unchanged. */
        val default: VehicleVisualAsset by lazy {
            val text = requireNotNull(AnatomyCarAsset::class.java.getResourceAsStream(AnatomyCarAsset.RESOURCE)) { "Missing ${AnatomyCarAsset.RESOURCE}" }
                .use { it.readBytes() }
            VehicleVisualAsset(VisualProfile.DEFAULT, AnatomyCarAsset.instance, sha256(text), text.size)
        }

        /**
         * Validate and parse an asset that does not ship with the app. It must declare the profile it
         * was generated for, contain only static path/group markup, and a closed-only profile must not
         * contain open door sections.
         */
        fun parseExternal(profile: VisualProfile, data: ByteArray): VehicleVisualAsset {
            fun fail(reason: String): Nothing = throw InvalidVisualAssetException(reason)
            if (profile == VisualProfile.DEFAULT) fail("the default profile only uses the bundled asset")
            if (data.isEmpty() || data.size > MAX_BYTES) fail("size ${data.size} outside 1..$MAX_BYTES bytes")
            val text = try {
                Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(data)).toString()
            } catch (_: CharacterCodingException) {
                fail("not UTF-8")
            }
            val headers = text.lineSequence().filter { it.startsWith("#") }.toList()
            if ("#visual-profile ${profile.id}" !in headers) fail("missing '#visual-profile ${profile.id}'")
            if (profile.doorPose == DoorPoseSupport.CLOSED_ONLY && "#door-pose closed-only" !in headers) fail("missing '#door-pose closed-only'")
            val car = try {
                AnatomyCarAsset.parse(text)
            } catch (e: RuntimeException) {
                fail("parse: ${e.message}")
            }
            if (car.width !in 1..4096 || car.height !in 1..4096) fail("view box ${car.width}x${car.height}")
            for (section in car.sections) when (section) {
                is AnatomyCarAsset.Section.Static -> checkMarkup(section.markup)
                is AnatomyCarAsset.Section.Door -> {
                    if (section.open && profile.doorPose == DoorPoseSupport.CLOSED_ONLY) fail("open section for ${section.door} in a closed-only drawing")
                    checkMarkup(section.markup)
                    if (!pathData(section.accent)) fail("accent for ${section.door} is not plain path data")
                }
            }
            return VehicleVisualAsset(profile, car, sha256(data), data.size)
        }

        // Static drawing only: these elements and attributes, values without markup or URL syntax.
        private val ELEMENTS = setOf("g", "path", "circle")
        private val ATTRIBUTES = setOf(
            "id", "data-part", "data-line", "d", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
            "stroke-linejoin", "stroke-linecap", "cx", "cy", "r",
        )
        // A single-pass scanner instead of regexes: path data runs to tens of kB, and regex matching
        // it cost ~30x more on the AVD's ART than on a desktop JVM (P2-A8 measurement).
        private fun safeChar(c: Char) = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '#' || c == ' ' || c == '.' || c == ',' || c == '-'
        private fun pathData(value: String) = value.isNotEmpty() && value.all { it in '0'..'9' || it == 'M' || it == 'L' || it == 'Z' || it == ' ' || it == '.' || it == '-' }

        /** Markup must be a sequence of `<name attr="value" ...>` / `</name>` / `<name .../>` tags and nothing else. */
        private fun checkMarkup(markup: String) {
            fun fail(reason: String, at: Int): Nothing = throw InvalidVisualAssetException("$reason at $at")
            var i = 0
            val n = markup.length
            fun word(): String {
                val from = i
                while (i < n && (markup[i] in 'a'..'z' || markup[i] == '-')) i++
                return markup.substring(from, i)
            }
            while (i < n) {
                if (markup[i] != '<') fail("text or unsupported markup", i)
                i++
                val closing = i < n && markup[i] == '/'
                if (closing) i++
                val name = word()
                if (name !in ELEMENTS) fail("element <$name>", i)
                while (true) {
                    val spaced = i < n && markup[i].isWhitespace()
                    while (i < n && markup[i].isWhitespace()) i++
                    if (i < n && markup[i] == '/') { i++; if (i < n && markup[i] == '>') break; fail("malformed tag", i) }
                    if (i < n && markup[i] == '>') break
                    if (closing || !spaced) fail("malformed tag", i)
                    val key = word()
                    if (key !in ATTRIBUTES) fail("attribute $key", i)
                    if (i + 1 >= n || markup[i] != '=' || markup[i + 1] != '"') fail("value of $key", i)
                    i += 2
                    while (i < n && markup[i] != '"') { if (!safeChar(markup[i])) fail("value of $key", i); i++ }
                    if (i >= n) fail("unterminated value of $key", i)
                    i++
                }
                i++ // '>'
            }
        }

        private fun sha256(data: ByteArray) = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
    }
}

/** Outcome of resolving a requested visual profile to a drawing. */
sealed interface VisualAssetResolution {
    val requested: VisualProfile
    val asset: VehicleVisualAsset

    data class Loaded(override val requested: VisualProfile, override val asset: VehicleVisualAsset) : VisualAssetResolution

    /** The requested drawing could not be used; the bundled reference is shown and the reason reported. */
    data class Fallback(override val requested: VisualProfile, val reason: String) : VisualAssetResolution {
        override val asset: VehicleVisualAsset get() = VehicleVisualAsset.default
    }
}

/**
 * Maps a profile to its drawing. The default profile always uses the bundled asset; any other
 * profile needs bytes from [external] (debug builds only) and falls back, with a reason, when they
 * are missing or invalid.
 */
class VehicleAssetResolver(private val external: (VisualProfile) -> ByteArray?) {
    fun resolve(requested: VisualProfile): VisualAssetResolution {
        if (requested == VisualProfile.DEFAULT) return VisualAssetResolution.Loaded(requested, VehicleVisualAsset.default)
        val data = try {
            external(requested)
        } catch (e: Exception) {
            return VisualAssetResolution.Fallback(requested, "ASSET_UNREADABLE: ${e.message}")
        } ?: return VisualAssetResolution.Fallback(requested, "ASSET_MISSING")
        return try {
            VisualAssetResolution.Loaded(requested, VehicleVisualAsset.parseExternal(requested, data))
        } catch (e: InvalidVisualAssetException) {
            VisualAssetResolution.Fallback(requested, "ASSET_INVALID: ${e.message}")
        }
    }
}
