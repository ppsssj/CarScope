package io.carscope.app.sync

import org.junit.Assert.*
import org.junit.Test

class ProvisionedSessionCredentialProviderTest {
    private val endpoint = SyncEndpoint("https://api.example", "https://mobile.example")
    private val issuer = "https://issuer.example/"
    private val audience = "carscope-sync-test"
    private fun identity(active: Boolean = true, ownership: Boolean = true, vehicle: String = "fixture-vehicle", expiresAt: Long = 2000) =
        RegisteredCreationIdentity("fixture-registration", "fixture-subject", "fixture-user", vehicle, "fixture-device", active, ownership, expiresAt)
    private fun lease(issuer: String = this.issuer, audience: String = this.audience, scope: Set<String> = setOf("inspection:session:create"),
        issuedAt: Long = 900, notBefore: Long = 900, expiresAt: Long = 1900, active: Boolean = true,
        identity: RegisteredCreationIdentity = identity(), token: String = "T".repeat(43)) =
        ProvisionedCreationCredential(SessionCreationCredential(token), issuer, audience, "fixture-grant", scope, issuedAt, notBefore, expiresAt, identity, active)
    private class Source(var value: ProvisionedCreationCredential?) : ProvisionedCredentialSource {
        var closes = 0
        override fun snapshot() = value
        override fun close() { value = null; closes++ }
    }
    private fun provider(source: ProvisionedCredentialSource, now: () -> Long = { 1000 }) =
        ProvisionedSessionCreationCredentialProvider(endpoint, issuer, audience, source, now)

    @Test fun `missing source and existing Activity default never grant creation`() {
        assertNull(ProvisionedSessionCreationCredentialProvider(endpoint, issuer, audience, now = { 1000 }).credential(endpoint))
        assertNull(DenyByDefaultCredentialProvider().credential(endpoint))
    }
    @Test fun `provisioned snapshot is exact API bound with redacted identity and credential`() {
        val source = Source(lease()); val p = provider(source)
        assertNotNull(p.credential(endpoint))
        assertNull(p.credential(SyncEndpoint("https://other.example", "https://mobile.example")))
        for (x in listOf(source.value, source.value!!.identity, p, source.value!!.credential)) {
            assertTrue(x.toString().contains("REDACTED")); assertFalse(x.toString().contains("fixture-vehicle")); assertFalse(x.toString().contains("T".repeat(43)))
        }
    }
    @Test fun `issuer audience scope active registration and ownership failures deny`() {
        for (value in listOf(lease(issuer = "https://other.example"), lease(audience = "other"), lease(scope = emptySet()),
            lease(scope = setOf("inspection:session:create", "admin")), lease(active = false), lease(identity = identity(active = false)),
            lease(identity = identity(ownership = false)), lease(identity = identity(vehicle = "")))) assertNull(provider(Source(value)).credential(endpoint))
    }
    @Test fun `expiry future time overlong grant and unsafe timestamps deny with no leeway`() {
        for (value in listOf(lease(expiresAt = 1000), lease(issuedAt = -1), lease(notBefore = 1001), lease(issuedAt = 1001),
            lease(expiresAt = 301001), lease(identity = identity(expiresAt = 1000)), lease(expiresAt = Long.MAX_VALUE))) assertNull(provider(Source(value)).credential(endpoint))
        var now = 1000L; val p = provider(Source(lease())) { now }
        assertNotNull(p.credential(endpoint)); now = 1900; assertNull(p.credential(endpoint))
    }
    @Test fun `revocation rotation and close do not retain an old lease`() {
        val source = Source(lease()); val p = provider(source)
        assertNotNull(p.credential(endpoint)); source.value = null; assertNull(p.credential(endpoint))
        source.value = lease(token = "R".repeat(43)); assertTrue(p.credential(endpoint)!!.authorizationValue() == "R".repeat(43))
        p.close(); p.close(); assertNull(p.credential(endpoint)); assertNull(source.value); assertEquals(1, source.closes)
    }
    @Test fun `source outage fails closed without exposing exception or fallback`() {
        val source = object : ProvisionedCredentialSource { override fun snapshot(): ProvisionedCreationCredential? = error("private provisioning failure") }
        assertNull(provider(source).credential(endpoint))
    }
    @Test fun `transport close releases the provisioning source once`() {
        val source = Source(lease()); val p = provider(source)
        val transport = HttpsSyncReceiverTransport(endpoint, p, SyncCallbackDispatcher { it() })
        transport.close(); transport.close(); assertEquals(1, source.closes); assertNull(source.value)
    }
}
