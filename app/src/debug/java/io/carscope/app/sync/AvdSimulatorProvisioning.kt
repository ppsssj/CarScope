package io.carscope.app.sync

import android.util.Log
import com.google.gson.JsonObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException

/** P6-D4: AVD-only operator approval. Never proves user identity, VIN or real-vehicle ownership. */
internal object AvdSimulatorPolicy {
    const val API_ORIGIN = "https://carscope-lluo.onrender.com"
    const val MODE = "OPERATOR_APPROVED_AVD_SIMULATION"
    const val AUDIENCE = "carscope-avd-simulator"
    const val SCOPE = "inspection:session:create"
    const val ENROLLMENT_FILENAME = "avd-simulator-enrollment.json"
    const val GRANT_MAX_TTL_MS = 120_000L
    const val ENROLLMENT_MAX_TTL_MS = 86_400_000L
    private val UUID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    private val TOKEN = Regex("[A-Za-z0-9_-]{43}")

    fun endpointAllowed(endpoint: SyncEndpoint) =
        endpoint.apiOrigin == API_ORIGIN && endpoint.mobileRoot.trimEnd('/') == API_ORIGIN

    fun enrollment(bytes: ByteArray, endpoint: SyncEndpoint, at: Long): AvdSimulatorEnrollment {
        require(endpointAllowed(endpoint) && bytes.size in 1..512 && at > 0)
        val x = SyncHttpDecoder.objectBody(bytes, "application/json")
        require(x.keys == setOf("mode", "registrationId", "enrollmentProof", "expiresAt"))
        require(x["mode"] == MODE)
        val id = x["registrationId"] as? String ?: error("INVALID_SIMULATOR_ENROLLMENT")
        val proof = x["enrollmentProof"] as? String ?: error("INVALID_SIMULATOR_ENROLLMENT")
        val expiresAt = SyncHttpDecoder.number(x["expiresAt"])
        require(UUID.matches(id) && TOKEN.matches(proof) && expiresAt > at &&
            expiresAt - at <= ENROLLMENT_MAX_TTL_MS)
        return AvdSimulatorEnrollment(id, proof, expiresAt)
    }

    /** This one operator-created file is separate from sync-endpoint.json and never passed through an Intent. */
    fun readEnrollment(filesDir: File, endpoint: SyncEndpoint, at: Long): AvdSimulatorEnrollment? = try {
        if (!endpointAllowed(endpoint)) null else {
            val file = File(filesDir, ENROLLMENT_FILENAME)
            if (!file.isFile || file.length() !in 1..512 || java.nio.file.Files.isSymbolicLink(file.toPath())) null
            else enrollment(file.readBytes(), endpoint, at)
        }
    } catch (_: Exception) { null }

    fun grant(bytes: ByteArray, contentType: String?, endpoint: SyncEndpoint, expectedRegistration: String, at: Long): AvdSimulatorGrant {
        require(endpointAllowed(endpoint) && UUID.matches(expectedRegistration) && at > 0)
        val x = SyncHttpDecoder.objectBody(bytes, contentType)
        require(x.keys == setOf("mode", "apiOrigin", "audience", "scope", "credential",
            "credentialId", "issuedAt", "notBefore", "expiresAt", "registrationId",
            "simulatorApproved", "realVehicleOwnershipVerified"))
        require(x["mode"] == MODE && x["apiOrigin"] == endpoint.apiOrigin &&
            x["audience"] == AUDIENCE && x["scope"] == SCOPE &&
            x["simulatorApproved"] === true && x["realVehicleOwnershipVerified"] === false)
        val credential = x["credential"] as? String ?: error("INVALID_SIMULATOR_GRANT")
        val credentialId = x["credentialId"] as? String ?: error("INVALID_SIMULATOR_GRANT")
        val registrationId = x["registrationId"] as? String ?: error("INVALID_SIMULATOR_GRANT")
        val issuedAt = SyncHttpDecoder.number(x["issuedAt"])
        val notBefore = SyncHttpDecoder.number(x["notBefore"])
        val expiresAt = SyncHttpDecoder.number(x["expiresAt"])
        require(TOKEN.matches(credential) && UUID.matches(credentialId) &&
            registrationId == expectedRegistration && issuedAt <= notBefore &&
            notBefore <= at && expiresAt > at && expiresAt > notBefore &&
            expiresAt - issuedAt <= GRANT_MAX_TTL_MS)
        return AvdSimulatorGrant(SessionCreationCredential(credential), expiresAt)
    }
}

internal class AvdSimulatorEnrollment(
    val registrationId: String, private val proof: String, val expiresAt: Long
) {
    fun credential(): EnrollmentCredential = EnrollmentCredential(proof)
    override fun toString() = "AvdSimulatorEnrollment(REDACTED)"
}

internal class AvdSimulatorGrant(val credential: SessionCreationCredential, val expiresAt: Long) {
    override fun toString() = "AvdSimulatorGrant(REDACTED)"
}

internal interface AvdSimulatorGrantExchange : AutoCloseable {
    fun fetch(callback: (AvdSimulatorGrant?) -> Unit): SyncCancellation
    override fun close() {}
}

/** Main-thread callbacks, worker-only I/O; trust store, TLS hostname and redirect policies are unchanged. */
internal class HttpsAvdSimulatorGrantExchange(
    private val endpoint: SyncEndpoint, private val enrollment: AvdSimulatorEnrollment,
    private val dispatcher: SyncCallbackDispatcher, private val now: () -> Long = System::currentTimeMillis,
    private val timeoutMs: Int = 5000,
    private val connections: (URI) -> HttpsURLConnection = { it.toURL().openConnection() as HttpsURLConnection }
) : AvdSimulatorGrantExchange {
    // Log only fixed diagnostic categories. Never log a proof, grant, URL with credentials or exception message.
    private val logTag = "CarScopeAvdAuth"
    private val uri = URI(AvdSimulatorPolicy.API_ORIGIN + "/simulator/provision")
    private val worker = Executors.newSingleThreadExecutor()
    private val deadlines = Executors.newSingleThreadScheduledExecutor()
    private val closed = AtomicBoolean(false)
    private val calls = java.util.concurrent.ConcurrentHashMap.newKeySet<Call>()

    init { require(AvdSimulatorPolicy.endpointAllowed(endpoint) && timeoutMs in 1..10000) }

    private inner class Call : SyncCancellation {
        val cancelled = AtomicBoolean(false)
        val completed = AtomicBoolean(false)
        @Volatile var connection: HttpsURLConnection? = null
        override fun cancel() {
            cancelled.set(true); completed.set(true); connection?.disconnect()
        }
    }

    override fun fetch(callback: (AvdSimulatorGrant?) -> Unit): SyncCancellation {
        val call = Call()
        if (closed.get()) return call
        calls.add(call)
        fun finish(result: AvdSimulatorGrant?) {
            if (call.completed.compareAndSet(false, true)) dispatcher.post {
                if (!closed.get() && !call.cancelled.get()) callback(result)
            }
        }
        val timer = try {
            deadlines.schedule({ finish(null); call.connection?.disconnect() }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        } catch (_: Exception) { calls.remove(call); finish(null); return call }
        try {
            val task = worker.submit {
                var grant: AvdSimulatorGrant? = null
                try {
                    if (!call.completed.get() && !closed.get() && now() < enrollment.expiresAt) {
                        val c = connections(uri); call.connection = c
                        if (call.completed.get() || closed.get()) throw InterruptedException()
                        c.requestMethod = "POST"; c.instanceFollowRedirects = false; c.useCaches = false
                        c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
                        c.setRequestProperty("Authorization", "Bearer " + enrollment.credential().authorizationValue())
                        c.setRequestProperty("Accept", "application/json")
                        c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        c.setRequestProperty("Cache-Control", "no-store")
                        val body = JsonObject().apply {
                            addProperty("apiOrigin", endpoint.apiOrigin)
                            addProperty("audience", AvdSimulatorPolicy.AUDIENCE)
                        }.toString().toByteArray(Charsets.UTF_8)
                        c.doOutput = true; c.setFixedLengthStreamingMode(body.size)
                        c.outputStream.use { it.write(body) }
                        val status = c.responseCode
                        if (status != 200) {
                            Log.w(logTag, "PROVISION_HTTP_STATUS_${status}")
                            error("INVALID_SIMULATOR_PROVISION")
                        }
                        if (c.contentLengthLong > SyncHttpDecoder.MAX_BYTES ||
                            c.getHeaderField("Content-Encoding")?.let { it != "identity" } == true) {
                            Log.w(logTag, "PROVISION_RESPONSE_HEADERS_REJECTED")
                            error("INVALID_SIMULATOR_PROVISION")
                        }
                        val bytes = ByteArrayOutputStream()
                        c.inputStream.use { input ->
                            val buffer = ByteArray(2048)
                            while (true) {
                                val n = input.read(buffer)
                                if (n < 0) break
                                if (call.cancelled.get() || bytes.size() + n > SyncHttpDecoder.MAX_BYTES)
                                    error("INVALID_SIMULATOR_PROVISION")
                                bytes.write(buffer, 0, n)
                            }
                        }
                        grant = AvdSimulatorPolicy.grant(bytes.toByteArray(), c.contentType, endpoint,
                            enrollment.registrationId, now())
                        Log.i(logTag, "PROVISION_GRANT_VERIFIED")
                    } else {
                        Log.w(logTag, "PROVISION_ENROLLMENT_EXPIRED_OR_CANCELLED")
                    }
                } catch (e: Exception) {
                    grant = null
                    // Deliberately omit exception messages, stack traces, request/response bodies and token values.
                    val category = when (e) {
                        is SocketTimeoutException -> "PROVISION_TIMEOUT"
                        is SSLException -> "PROVISION_TLS_REJECTED"
                        is UnknownHostException -> "PROVISION_DNS_FAILURE"
                        is SyncHttpDecoder.Invalid -> "PROVISION_RESPONSE_INVALID_JSON"
                        is IllegalArgumentException -> "PROVISION_RESPONSE_CONTRACT_REJECTED"
                        else -> "PROVISION_REQUEST_FAILED"
                    }
                    Log.w(logTag, category)
                }
                finally {
                    timer.cancel(false); call.connection?.disconnect(); calls.remove(call)
                    finish(grant)
                }
            }
            return SyncCancellation { timer.cancel(false); call.cancel(); task.cancel(true); calls.remove(call) }
        } catch (_: Exception) { timer.cancel(false); calls.remove(call); finish(null); return call }
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            calls.forEach { it.cancel() }; calls.clear()
            worker.shutdownNow(); deadlines.shutdownNow()
        }
    }
    override fun toString() = "HttpsAvdSimulatorGrantExchange(REDACTED)"
}

/** Separate from OEM ProvisionedCreationCredential; never asserts ownershipVerified=true. */
internal class RefreshingAvdSimulatorCredentialSource(
    private val endpoint: SyncEndpoint, private val exchange: AvdSimulatorGrantExchange,
    private val now: () -> Long = System::currentTimeMillis
) : AutoCloseable {
    init { require(AvdSimulatorPolicy.endpointAllowed(endpoint)) }
    private var value: AvdSimulatorGrant? = null
    private var generation = 0L
    private var closed = false
    private var pending: SyncCancellation? = null

    @Synchronized fun snapshot(): SessionCreationCredential? {
        if (closed || value?.expiresAt?.let { it <= now() } != false) value = null
        return value?.credential
    }

    @Synchronized fun refresh(callback: (Boolean) -> Unit = {}) {
        invalidate(); if (closed) return
        val mine = generation
        val started = try {
            exchange.fetch { grant -> synchronized(this) {
                if (!closed && generation == mine) {
                    value = grant?.takeIf { it.expiresAt > now() }
                    pending = null
                    callback(value != null)
                }
            } }
        } catch (_: Exception) { callback(false); return }
        if (closed || mine != generation) started.cancel() else pending = started
    }

    @Synchronized fun invalidate() {
        generation++; pending?.cancel(); pending = null; value = null
    }
    @Synchronized override fun close() {
        if (!closed) { closed = true; invalidate(); exchange.close() }
    }
    fun provider(): SessionCreationCredentialProvider = object : SessionCreationCredentialProvider {
        override fun credential(endpoint: SyncEndpoint) =
            if (AvdSimulatorPolicy.endpointAllowed(endpoint) && endpoint.apiOrigin == this@RefreshingAvdSimulatorCredentialSource.endpoint.apiOrigin)
                snapshot() else null
        override fun close() = this@RefreshingAvdSimulatorCredentialSource.close()
        override fun toString() = "AvdSimulatorCreationCredentialProvider(REDACTED)"
    }
}
