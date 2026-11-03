package io.carscope.app.sync

import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

/** Trusted provisioning output only. No Intent, endpoint JSON, device ID or token decoding can create trust. */
internal class RegisteredCreationIdentity(
    val registrationId: String, val subject: String, val userId: String, val vehicleId: String, val deviceId: String,
    val active: Boolean, val ownershipVerified: Boolean, val expiresAt: Long
) {
    override fun toString() = "RegisteredCreationIdentity(REDACTED)"
}
internal class ProvisionedCreationCredential(
    val credential: SessionCreationCredential, val issuer: String, val audience: String,
    val credentialId: String, scope: Set<String>, val issuedAt: Long, val notBefore: Long, val expiresAt: Long,
    val identity: RegisteredCreationIdentity, val active: Boolean
) {
    val scope = scope.toSet()
    override fun toString() = "ProvisionedCreationCredential(REDACTED)"
}
/** Nonblocking local snapshot from a separately reviewed enrollment/refresh integration; no I/O on UI thread. */
internal interface ProvisionedCredentialSource : AutoCloseable {
    fun snapshot(): ProvisionedCreationCredential?
    override fun close() {}
}
internal class UnavailableProvisionedCredentialSource : ProvisionedCredentialSource {
    override fun snapshot(): ProvisionedCreationCredential? = null
}

/** Optional integration seam. SyncReceiverActivity still constructs DenyByDefaultCredentialProvider. */
internal class ProvisionedSessionCreationCredentialProvider(
    endpoint: SyncEndpoint, private val issuer: String, private val audience: String,
    private val source: ProvisionedCredentialSource = UnavailableProvisionedCredentialSource(),
    private val now: () -> Long = System::currentTimeMillis
) : SessionCreationCredentialProvider {
    private val apiOrigin = endpoint.apiOrigin
    private val closed = AtomicBoolean(false)
    init { requireCreationPolicy(issuer, audience) }
    override fun credential(endpoint: SyncEndpoint): SessionCreationCredential? = try {
        if (closed.get() || endpoint.apiOrigin != apiOrigin) null else {
            val value = validatedProvisionedCredential(source.snapshot(), issuer, audience, now())
            if (closed.get()) null else value
        }
    } catch (_: Exception) { null }
    override fun close() { if (closed.compareAndSet(false, true)) source.close() }
    override fun toString() = "ProvisionedSessionCreationCredentialProvider(REDACTED)"
}

internal fun requireCreationPolicy(issuer: String, audience: String) {
    val uri = try { URI(issuer) } catch (_: Exception) { throw IllegalArgumentException("INVALID_AUTH_POLICY") }
    require(issuer.length <= 512 && issuer.all { it.code in 33..126 } && uri.scheme == "https" && !uri.host.isNullOrBlank() &&
        uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.port == -1 || uri.port in 1..65535)) { "INVALID_AUTH_POLICY" }
    require(audience.length in 1..256 && audience.all { it.code in 33..126 }) { "INVALID_AUTH_POLICY" }
}

internal fun validatedProvisionedCredential(c: ProvisionedCreationCredential?, issuer: String, audience: String, at: Long): SessionCreationCredential? {
    val identity = c?.identity
    val id = Regex("[A-Za-z0-9:_-]{1,128}")
    return if (c == null || identity == null || !c.active || c.issuer != issuer || c.audience != audience ||
        c.scope != setOf("inspection:session:create") || !id.matches(c.credentialId) ||
        !listOf(identity.registrationId, identity.subject, identity.userId, identity.vehicleId, identity.deviceId).all(id::matches) ||
        !identity.active || !identity.ownershipVerified || at < 0 || c.issuedAt < 0 || c.notBefore < c.issuedAt ||
        c.notBefore > at || c.expiresAt <= at || c.expiresAt <= c.notBefore || c.expiresAt - c.issuedAt > 300_000 ||
        listOf(at, c.issuedAt, c.notBefore, c.expiresAt, identity.expiresAt).any { it > 9_007_199_254_740_991L } || identity.expiresAt <= at) null else c.credential
}
