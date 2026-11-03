package io.carscope.app.sync

import com.google.gson.JsonObject
import java.io.ByteArrayOutputStream
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

/** Separate trusted login/enrollment proof. Never supplied by Intent, endpoint file or a session QR. */
internal class EnrollmentCredential(private val value: String) {
    init { require(Regex("[A-Za-z0-9_-]{32,128}").matches(value)) }
    fun authorizationValue() = value
    override fun toString() = "EnrollmentCredential(REDACTED)"
}
internal interface EnrollmentCredentialSource : AutoCloseable {
    fun snapshot(): EnrollmentCredential?
    override fun close() {}
}
internal interface ProvisioningExchange : AutoCloseable {
    fun fetch(callback: (ProvisionedCreationCredential?) -> Unit): SyncCancellation
    override fun close() {}
}

/** Fixed operator origin and normalized response, not a generic OAuth/JWT client. */
internal object ProvisioningDecoder {
    fun decode(bytes: ByteArray, type: String?, endpoint: SyncEndpoint, issuer: String, audience: String, now: Long): ProvisionedCreationCredential {
        requireCreationPolicy(issuer, audience)
        val x = SyncHttpDecoder.objectBody(bytes, type)
        require(x.keys == setOf("apiOrigin", "credential", "issuer", "audience", "credentialId", "scope", "issuedAt", "notBefore", "expiresAt", "active", "identity"))
        require(x["apiOrigin"] == endpoint.apiOrigin && x["issuer"] == issuer && x["audience"] == audience && x["scope"] == "inspection:session:create")
        val identity = x["identity"] as? Map<*, *> ?: error("INVALID_PROVISIONING")
        require(identity.keys == setOf("registrationId", "subject", "userId", "vehicleId", "deviceId", "active", "ownershipVerified", "expiresAt"))
        fun string(map: Map<*, *>, key: String) = map[key] as? String ?: error("INVALID_PROVISIONING")
        fun flag(map: Map<*, *>, key: String) = map[key] as? Boolean ?: error("INVALID_PROVISIONING")
        val result = ProvisionedCreationCredential(SessionCreationCredential(string(x, "credential")), string(x, "issuer"), string(x, "audience"), string(x, "credentialId"),
            setOf("inspection:session:create"), SyncHttpDecoder.number(x["issuedAt"]), SyncHttpDecoder.number(x["notBefore"]), SyncHttpDecoder.number(x["expiresAt"]),
            RegisteredCreationIdentity(string(identity, "registrationId"), string(identity, "subject"), string(identity, "userId"), string(identity, "vehicleId"), string(identity, "deviceId"),
                flag(identity, "active"), flag(identity, "ownershipVerified"), SyncHttpDecoder.number(identity["expiresAt"])), flag(x, "active"))
        require(validatedProvisionedCredential(result, issuer, audience, now) != null)
        return result
    }
}

/** Worker I/O, bounded total deadline, per-call cancellation; default CA and hostname checks are untouched. */
internal class HttpsProvisioningExchange(
    private val endpoint: SyncEndpoint, authorityOrigin: String, private val issuer: String, private val audience: String,
    private val enrollment: EnrollmentCredentialSource, private val dispatcher: SyncCallbackDispatcher,
    private val now: () -> Long = System::currentTimeMillis, private val timeoutMs: Int = 5000,
    private val connections: (URI) -> HttpsURLConnection = { it.toURL().openConnection() as HttpsURLConnection }
) : ProvisioningExchange {
    private val url = URI(requireHttpsMobileRoot(authorityOrigin).trimEnd('/') + "/creation/provision")
    private val worker = Executors.newSingleThreadExecutor()
    private val deadline = Executors.newSingleThreadScheduledExecutor()
    private val closed = AtomicBoolean(false)
    private val calls = java.util.concurrent.ConcurrentHashMap.newKeySet<Call>()
    init { require(timeoutMs in 1..10000); require(url.port == -1 || url.port in 1..65535); requireCreationPolicy(issuer, audience) }
    private inner class Call : SyncCancellation {
        val cancelled = AtomicBoolean(false)
        val completed = AtomicBoolean(false)
        @Volatile var connection: HttpsURLConnection? = null
        override fun cancel() { cancelled.set(true); completed.set(true); connection?.disconnect() }
    }
    override fun fetch(callback: (ProvisionedCreationCredential?) -> Unit): SyncCancellation {
        val call = Call(); if (closed.get()) return call
        calls.add(call)
        fun finish(value: ProvisionedCreationCredential?) {
            if (call.completed.compareAndSet(false, true)) dispatcher.post { if (!call.cancelled.get() && !closed.get()) callback(value) }
        }
        val timer = try { deadline.schedule({ finish(null); call.connection?.disconnect() }, timeoutMs.toLong(), TimeUnit.MILLISECONDS) }
            catch (_: Exception) { calls.remove(call); finish(null); return call }
        try {
            val task = worker.submit {
                var grant: ProvisionedCreationCredential? = null
                try {
                    val proof = enrollment.snapshot()
                    if (proof != null && !call.completed.get() && !closed.get()) {
                        val c = connections(url); call.connection = c
                        if (call.completed.get() || closed.get()) throw InterruptedException()
                        c.instanceFollowRedirects = false; c.useCaches = false; c.requestMethod = "POST"
                        c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
                        c.setRequestProperty("Authorization", "Bearer " + proof.authorizationValue())
                        c.setRequestProperty("Content-Type", "application/json; charset=utf-8"); c.setRequestProperty("Accept", "application/json"); c.setRequestProperty("Cache-Control", "no-store")
                        val body = JsonObject().apply { addProperty("apiOrigin", endpoint.apiOrigin); addProperty("audience", audience) }.toString().toByteArray(Charsets.UTF_8)
                        c.doOutput = true; c.setFixedLengthStreamingMode(body.size); c.outputStream.use { it.write(body) }
                        if (c.responseCode != 200 || c.contentLengthLong > SyncHttpDecoder.MAX_BYTES || c.getHeaderField("Content-Encoding")?.let { it != "identity" } == true) error("INVALID_PROVISIONING")
                        val bytes = ByteArrayOutputStream()
                        c.inputStream.use { input ->
                            val buffer = ByteArray(2048)
                            while (true) { val n = input.read(buffer); if (n < 0) break
                                if (call.cancelled.get() || bytes.size() + n > SyncHttpDecoder.MAX_BYTES) error("INVALID_PROVISIONING")
                                bytes.write(buffer, 0, n)
                            }
                        }
                        grant = ProvisioningDecoder.decode(bytes.toByteArray(), c.contentType, endpoint, issuer, audience, now())
                    }
                } catch (_: Exception) { grant = null }
                finally {
                    timer.cancel(false); call.connection?.disconnect(); calls.remove(call)
                    finish(grant)
                }
            }
            return SyncCancellation { timer.cancel(false); call.cancel(); task.cancel(true); calls.remove(call) }
        } catch (_: Exception) { timer.cancel(false); calls.remove(call); finish(null); return call }
    }
    override fun close() { if (closed.compareAndSet(false, true)) { calls.forEach { it.cancel() }; calls.clear(); worker.shutdownNow(); deadline.shutdownNow(); enrollment.close() } }
    override fun toString() = "HttpsProvisioningExchange(REDACTED)"
}

/** Explicit refresh/reconnect drops the previous lease first. Getters never perform network or disk I/O. */
internal class RefreshingProvisionedCredentialSource(
    private val endpoint: SyncEndpoint, private val issuer: String, private val audience: String,
    private val exchange: ProvisioningExchange, private val now: () -> Long = System::currentTimeMillis
) : ProvisionedCredentialSource {
    init { requireCreationPolicy(issuer, audience) }
    private var value: ProvisionedCreationCredential? = null
    private var generation = 0L
    private var closed = false
    private var request: SyncCancellation? = null
    @Synchronized override fun snapshot(): ProvisionedCreationCredential? {
        if (closed || validatedProvisionedCredential(value, issuer, audience, now()) == null) value = null
        return value
    }
    @Synchronized fun refresh(callback: (Boolean) -> Unit = {}) {
        invalidate(); if (closed) return
        val owner = generation
        val issued = try { exchange.fetch { grant -> synchronized(this) {
            if (!closed && owner == generation) {
                value = grant.takeIf { validatedProvisionedCredential(it, issuer, audience, now()) != null }
                request = null; callback(value != null)
            }
        } } } catch (_: Exception) { if (!closed && owner == generation) callback(false); return }
        if (closed || owner != generation) issued.cancel() else request = issued
    }
    @Synchronized fun invalidate() { generation++; request?.cancel(); request = null; value = null }
    @Synchronized override fun close() { if (!closed) { closed = true; invalidate(); exchange.close() } }
    override fun toString() = "RefreshingProvisionedCredentialSource(REDACTED)"
    fun provider() = ProvisionedSessionCreationCredentialProvider(endpoint, issuer, audience, this, now)
}
