package io.carscope.app.sync

import org.junit.Assert.*
import org.junit.Test
import io.carscope.app.BuildConfig
import java.io.File
import java.nio.file.Files

internal object AvdSimulatorSamples {
    val endpoint = SyncEndpoint(AvdSimulatorPolicy.API_ORIGIN, AvdSimulatorPolicy.API_ORIGIN)
    const val registration = "00000000-0000-4000-8000-000000000001"
    const val grantId = "00000000-0000-4000-8000-000000000002"
    val proof = "E".repeat(43)
    val token = "G".repeat(43)
    fun enrollment(expiresAt: Long = 300000) =
        """{"mode":"OPERATOR_APPROVED_AVD_SIMULATION","registrationId":"$registration","enrollmentProof":"$proof","expiresAt":$expiresAt}"""
    fun grant(expiresAt: Long = 122000) =
        """{"mode":"OPERATOR_APPROVED_AVD_SIMULATION","apiOrigin":"https://carscope-lluo.onrender.com","audience":"carscope-avd-simulator","scope":"inspection:session:create","credential":"$token","credentialId":"$grantId","issuedAt":2000,"notBefore":2000,"expiresAt":$expiresAt,"registrationId":"$registration","simulatorApproved":true,"realVehicleOwnershipVerified":false}"""
    fun value() = AvdSimulatorPolicy.grant(grant().toByteArray(), "application/json", endpoint, registration, 2100)
}
internal class PendingAvdSimulatorExchange : AvdSimulatorGrantExchange {
    val callbacks = mutableListOf<(AvdSimulatorGrant?) -> Unit>()
    var cancelled = 0; var closes = 0
    override fun fetch(callback: (AvdSimulatorGrant?) -> Unit): SyncCancellation {
        callbacks.add(callback); return SyncCancellation { cancelled++ }
    }
    override fun close() { closes++ }
}

class AvdSimulatorProvisioningTest {
    @Test fun experimentOriginIsCompiledExactAndNeverAnArbitraryRuntimeHost() {
        val origin = "https://carscope-vision-test.onrender.com"
        assertTrue(AvdSimulatorPolicy.allowedOrigin(AvdSimulatorPolicy.API_ORIGIN, ""))
        assertFalse(AvdSimulatorPolicy.allowedOrigin(origin, ""))
        assertTrue(AvdSimulatorPolicy.allowedOrigin(origin, origin))
        for (bad in listOf("http://carscope-vision-test.onrender.com", "$origin/", "$origin.evil.example",
            "https://evil.example", "https://user@carscope-vision-test.onrender.com")) {
            assertFalse(AvdSimulatorPolicy.allowedOrigin(bad, origin))
            assertFalse(AvdSimulatorPolicy.allowedOrigin(bad, bad))
        }
    }

    @Test fun compiledExperimentUsesItsOwnEnrollmentFile() {
        val origin = BuildConfig.VISION_EXPERIMENT_ORIGIN
        if (origin.isEmpty()) {
            assertFalse(AvdSimulatorPolicy.endpointAllowed(SyncEndpoint("https://carscope-vision-test.onrender.com", "https://carscope-vision-test.onrender.com/")))
            return
        }
        val endpoint = SyncEndpoint(origin, "$origin/")
        assertTrue(AvdSimulatorPolicy.endpointAllowed(endpoint))
        assertFalse(AvdSimulatorPolicy.endpointAllowed(SyncEndpoint(origin, AvdSimulatorPolicy.API_ORIGIN)))
        val dir = Files.createTempDirectory("vision-enrollment-test").toFile()
        try {
            File(dir, AvdSimulatorPolicy.ENROLLMENT_FILENAME).writeText(AvdSimulatorSamples.enrollment())
            assertNull(AvdSimulatorPolicy.readEnrollment(dir, endpoint, 2100))
            File(dir, AvdSimulatorPolicy.VISION_ENROLLMENT_FILENAME).writeText(AvdSimulatorSamples.enrollment())
            assertNotNull(AvdSimulatorPolicy.readEnrollment(dir, endpoint, 2100))
        } finally { dir.deleteRecursively() }
    }
    @Test fun `one millisecond before notBefore is rejected without clock tolerance and exact expiry is denied`() {
        val raw = AvdSimulatorSamples.grant().toByteArray()
        assertThrows(AvdSimulatorPolicy.GrantNotYetValid::class.java) {
            AvdSimulatorPolicy.grant(raw, "application/json", AvdSimulatorSamples.endpoint, AvdSimulatorSamples.registration, 1999)
        }
        assertNotNull(AvdSimulatorPolicy.grant(raw, "application/json", AvdSimulatorSamples.endpoint, AvdSimulatorSamples.registration, 2000))
        assertThrows(AvdSimulatorPolicy.GrantExpired::class.java) {
            AvdSimulatorPolicy.grant(raw, "application/json", AvdSimulatorSamples.endpoint, AvdSimulatorSamples.registration, 122000)
        }
    }

    @Test fun `each refresh consumes only its first callback including synchronous completion`() {
        val pending = PendingAvdSimulatorExchange()
        val source = RefreshingAvdSimulatorCredentialSource(AvdSimulatorSamples.endpoint, pending) { 2100 }
        var completions = 0
        source.refresh { completions++ }
        val first = pending.callbacks.last()
        first(null)
        first(AvdSimulatorSamples.value())
        assertNull(source.snapshot())
        assertEquals(1, completions)
        source.refresh { completions++ }
        val second = pending.callbacks.last()
        second(AvdSimulatorSamples.value())
        second(null)
        assertNotNull(source.snapshot())
        assertEquals(2, completions)
        source.close()

        var cancellations = 0
        val synchronous = object : AvdSimulatorGrantExchange {
            override fun fetch(callback: (AvdSimulatorGrant?) -> Unit): SyncCancellation {
                callback(AvdSimulatorSamples.value())
                return SyncCancellation { cancellations++ }
            }
        }
        val inline = RefreshingAvdSimulatorCredentialSource(AvdSimulatorSamples.endpoint, synchronous) { 2100 }
        inline.refresh()
        assertNotNull(inline.snapshot())
        inline.invalidate()
        assertNull(inline.snapshot())
        assertEquals(0, cancellations) // Completed work must not be installed as pending.
        inline.close()
    }

    @Test fun `operator file accepts only fixed public origin strict fields and currently valid proof`() {
        val root = Files.createTempDirectory("carscope-avd-proof-").toFile()
        try {
            val file = File(root, AvdSimulatorPolicy.ENROLLMENT_FILENAME)
            assertNull(AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 2100))
            file.writeText(AvdSimulatorSamples.enrollment())
            val loaded = AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 2100)!!
            assertEquals(AvdSimulatorSamples.registration, loaded.registrationId)
            assertEquals(AvdSimulatorSamples.proof, loaded.credential().authorizationValue())
            assertFalse(loaded.toString().contains(AvdSimulatorSamples.proof))
            assertNotNull(AvdSimulatorPolicy.enrollment(file.readBytes(), AvdSimulatorSamples.endpoint, 2100))
            assertNull(AvdSimulatorPolicy.readEnrollment(root, SyncEndpoint("https://other.example", "https://other.example"), 2100))
            assertNull(AvdSimulatorPolicy.readEnrollment(root,
                SyncEndpoint(AvdSimulatorPolicy.API_ORIGIN, "https://mobile.example"), 2100))
            assertNull(AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 300000))
            file.writeText(AvdSimulatorSamples.enrollment().replace("OPERATOR_APPROVED_AVD_SIMULATION", "OTHER"))
            assertNull(AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 2100))
            file.writeText(AvdSimulatorSamples.enrollment().replace("000000000001", "000000000099"))
            assertNotNull(AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 2100))
            file.writeText(AvdSimulatorSamples.enrollment().replace("\"registrationId\":", "\"extra\":true,\"registrationId\":"))
            assertNull(AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 2100))
            file.writeText(AvdSimulatorSamples.enrollment().replace("\"registrationId\":", "\"registrationId\":\"bad\",\"registrationId\":"))
            assertNull(AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 2100))
            file.writeText(AvdSimulatorSamples.enrollment().replace(AvdSimulatorSamples.proof, "short"))
            assertNull(AvdSimulatorPolicy.readEnrollment(root, AvdSimulatorSamples.endpoint, 2100))
        } finally {
            File(root, AvdSimulatorPolicy.ENROLLMENT_FILENAME).delete()
            root.delete()
        }
    }

    @Test fun `grants enforce simulation-only flags, canonical origin, binding, TTL and strict JSON`() {
        val raw = AvdSimulatorSamples.grant()
        val valid = AvdSimulatorSamples.value()
        assertEquals(AvdSimulatorSamples.token, valid.credential.authorizationValue())
        assertFalse(valid.toString().contains(AvdSimulatorSamples.token))
        fun rejects(source: String, type: String = "application/json") {
            try {
                AvdSimulatorPolicy.grant(source.toByteArray(), type, AvdSimulatorSamples.endpoint,
                    AvdSimulatorSamples.registration, 2100)
                fail("invalid simulation response was accepted")
            } catch (_: IllegalArgumentException) {
            } catch (_: SyncHttpDecoder.Invalid) {
            } catch (_: IllegalStateException) {}
        }
        for ((a,b) in listOf(
            "\"mode\":\"OPERATOR_APPROVED_AVD_SIMULATION\"" to "\"mode\":\"PRODUCTION\"",
            "\"realVehicleOwnershipVerified\":false" to "\"realVehicleOwnershipVerified\":true",
            "\"simulatorApproved\":true" to "\"simulatorApproved\":false",
            "\"audience\":\"carscope-avd-simulator\"" to "\"audience\":\"wrong\"",
            "\"apiOrigin\":\"https://carscope-lluo.onrender.com\"" to "\"apiOrigin\":\"https://other.example\"",
            "\"scope\":\"inspection:session:create\"" to "\"scope\":\"admin\"",
            ("\"registrationId\":\"" + AvdSimulatorSamples.registration + "\"") to "\"registrationId\":\"00000000-0000-4000-8000-000000000003\"",
            "\"expiresAt\":122000" to "\"expiresAt\":2000",
            "\"expiresAt\":122000" to "\"expiresAt\":122001",
            "\"issuedAt\":2000" to "\"issuedAt\":\"2000\"",
            ("\"credential\":\"" + AvdSimulatorSamples.token + "\"") to "\"credential\":\"short\"",
            ("\"credentialId\":\"" + AvdSimulatorSamples.grantId + "\"") to "\"credentialId\":\"bad\"",
            "\"mode\":" to "\"unexpected\":true,\"mode\":",
            "\"mode\":" to "\"mode\":\"OTHER\",\"mode\":"
        )) rejects(raw.replace(a,b))
        rejects(raw, "text/plain")
        assertNull(RefreshingAvdSimulatorCredentialSource(AvdSimulatorSamples.endpoint,
            PendingAvdSimulatorExchange()) { 2100 }.snapshot())
        try { AvdSimulatorPolicy.grant(raw.toByteArray(), "application/json", AvdSimulatorSamples.endpoint, AvdSimulatorSamples.registration, 122000); fail("expired accepted") }
        catch (_: Exception) {}
        try { AvdSimulatorPolicy.grant(raw.toByteArray(), "application/json", AvdSimulatorSamples.endpoint, AvdSimulatorSamples.registration, 1999); fail("notBefore accepted") }
        catch (_: Exception) {}
    }

    @Test fun `refresh invalidates before IO, expires locally, ignores late callbacks and closes once`() {
        var now=2100L
        val pending=PendingAvdSimulatorExchange()
        val source=RefreshingAvdSimulatorCredentialSource(AvdSimulatorSamples.endpoint,pending) { now }
        val provider=source.provider()
        assertNull(provider.credential(AvdSimulatorSamples.endpoint))
        assertNull(provider.credential(SyncEndpoint("https://other.example","https://other.example")))
        source.refresh()
        assertEquals(1,pending.callbacks.size)
        assertNull(provider.credential(AvdSimulatorSamples.endpoint))
        pending.callbacks.last()(AvdSimulatorSamples.value())
        assertEquals(AvdSimulatorSamples.token,provider.credential(AvdSimulatorSamples.endpoint)?.authorizationValue())
        source.refresh()
        assertNull(provider.credential(AvdSimulatorSamples.endpoint))
        val delayed=pending.callbacks.last()
        source.refresh()
        delayed(AvdSimulatorSamples.value())
        assertNull(provider.credential(AvdSimulatorSamples.endpoint))
        pending.callbacks.last()(AvdSimulatorSamples.value())
        assertNotNull(provider.credential(AvdSimulatorSamples.endpoint))
        now=122000
        assertNull(provider.credential(AvdSimulatorSamples.endpoint))
        source.refresh()
        val late=pending.callbacks.last()
        source.close(); source.close()
        late(AvdSimulatorSamples.value())
        assertNull(provider.credential(AvdSimulatorSamples.endpoint))
        assertEquals(1,pending.closes)
        assertTrue(pending.cancelled >= 1)
    }
}
