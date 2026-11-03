package io.carscope.app.sync

import org.junit.Assert.*
import org.junit.Test

internal object ProvisioningSamples {
    val endpoint = SyncEndpoint("https://api.example/", "https://api.example/")
    const val issuer = "https://issuer.example/"
    const val audience = "carscope-sync"
    fun lease(expiresAt: Long = 2000, issuer: String = this.issuer) = ProvisionedCreationCredential(
        SessionCreationCredential("S".repeat(43)), issuer, audience, "grant", setOf("inspection:session:create"), 900, 900, expiresAt,
        RegisteredCreationIdentity("registration", "subject", "user", "vehicle", "device", true, true, 4000), true)
    fun wire() = """{"apiOrigin":"https://api.example","credential":"${"S".repeat(43)}","issuer":"$issuer","audience":"$audience","credentialId":"grant","scope":"inspection:session:create","issuedAt":900,"notBefore":900,"expiresAt":2000,"active":true,"identity":{"registrationId":"registration","subject":"subject","userId":"user","vehicleId":"vehicle","deviceId":"device","active":true,"ownershipVerified":true,"expiresAt":4000}}"""
}
internal class PendingProvisioningExchange : ProvisioningExchange {
    val callbacks = mutableListOf<(ProvisionedCreationCredential?) -> Unit>()
    var cancellations = 0; var closes = 0
    override fun fetch(callback: (ProvisionedCreationCredential?) -> Unit): SyncCancellation { callbacks.add(callback); return SyncCancellation { cancellations++ } }
    override fun close() { closes++ }
}

class ProvisioningLifecycleTest {
    @Test fun `explicit refresh invalidates old credential before I O and expiry never triggers automatic creation`() {
        val x = PendingProvisioningExchange(); var now = 1000L
        val s = RefreshingProvisionedCredentialSource(ProvisioningSamples.endpoint, ProvisioningSamples.issuer, ProvisioningSamples.audience, x) { now }
        val p = s.provider(); s.refresh(); assertNull(p.credential(ProvisioningSamples.endpoint))
        x.callbacks.last()(ProvisioningSamples.lease()); assertNotNull(p.credential(ProvisioningSamples.endpoint))
        s.refresh(); assertNull(p.credential(ProvisioningSamples.endpoint)); x.callbacks.last()(null); assertNull(s.snapshot())
        s.refresh(); x.callbacks.last()(ProvisioningSamples.lease()); now = 2000
        assertNull(p.credential(ProvisioningSamples.endpoint)); assertNull(s.snapshot()); assertEquals(3, x.callbacks.size)
        p.close(); assertEquals(1, x.closes)
    }
    @Test fun `out of order refresh logout revoke and close discard delayed credentials`() {
        val x = PendingProvisioningExchange()
        val s = RefreshingProvisionedCredentialSource(ProvisioningSamples.endpoint, ProvisioningSamples.issuer, ProvisioningSamples.audience, x) { 1000 }
        s.refresh(); val first = x.callbacks.last(); s.refresh(); first(ProvisioningSamples.lease()); assertNull(s.snapshot())
        x.callbacks.last()(ProvisioningSamples.lease()); assertNotNull(s.snapshot())
        s.invalidate(); assertNull(s.snapshot()); first(ProvisioningSamples.lease()); assertNull(s.snapshot())
        s.refresh(); val late = x.callbacks.last(); s.close(); s.close(); late(ProvisioningSamples.lease()); assertNull(s.snapshot()); assertEquals(1, x.closes)
    }
    @Test fun `invalid policy grant and exchange failure never restore a previous lease`() {
        val x = PendingProvisioningExchange()
        val s = RefreshingProvisionedCredentialSource(ProvisioningSamples.endpoint, ProvisioningSamples.issuer, ProvisioningSamples.audience, x) { 1000 }
        s.refresh(); x.callbacks.last()(ProvisioningSamples.lease(issuer = "https://wrong.example/")); assertNull(s.snapshot())
        s.refresh(); x.callbacks.last()(ProvisioningSamples.lease(expiresAt = 1000)); assertNull(s.snapshot())
        val failing = object : ProvisioningExchange { override fun fetch(callback: (ProvisionedCreationCredential?) -> Unit): SyncCancellation = error("secret adapter error") }
        var success = true
        RefreshingProvisionedCredentialSource(ProvisioningSamples.endpoint, ProvisioningSamples.issuer, ProvisioningSamples.audience, failing).refresh { success = it }
        assertFalse(success)
    }
    @Test fun `provisioning response strictly binds endpoint policy identity and safe numeric fields`() {
        fun decode(raw: String) = ProvisioningDecoder.decode(raw.toByteArray(), "application/json", ProvisioningSamples.endpoint, ProvisioningSamples.issuer, ProvisioningSamples.audience, 1000)
        assertNotNull(decode(ProvisioningSamples.wire()))
        for (issuer in listOf("http://issuer.example", "https://user:secret@issuer.example", "https://issuer.example/#token", "https://issuer.example:0")) {
            try { RefreshingProvisionedCredentialSource(ProvisioningSamples.endpoint, issuer, ProvisioningSamples.audience, PendingProvisioningExchange()); fail("invalid policy accepted") }
            catch (_: IllegalArgumentException) {}
        }
        for ((a, b) in listOf("https://api.example" to "https://wrong.example", "carscope-sync" to "other", "inspection:session:create" to "admin",
            "\"issuedAt\":900" to "\"issuedAt\":\"900\"", "\"expiresAt\":2000" to "\"expiresAt\":1000", "\"active\":true" to "\"active\":1",
            "\"ownershipVerified\":true" to "\"ownershipVerified\":false", "\"identity\":{" to "\"identity\":{\"vin\":\"forbidden\",",
            "\"credentialId\":\"grant\"" to "\"credentialId\":\"grant\",\"credentialId\":\"other\"", "\"issuedAt\":900," to "")) {
            try { decode(ProvisioningSamples.wire().replace(a, b)); fail("invalid provisioning accepted (redacted)") } catch (_: Exception) {}
        }
    }
}
