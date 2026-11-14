package io.carscope.app.sync

import android.util.Log
import io.carscope.app.BuildConfig
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
    const val VISION_ENROLLMENT_FILENAME = "avd-vision-enrollment.json"
    const val GRANT_MAX_TTL_MS = 120_000L
    const val ENROLLMENT_MAX_TTL_MS = 86_400_000L
    private val UUID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    private val TOKEN = Regex("[A-Za-z0-9_-]{43}")
    class GrantNotYetValid : IllegalArgumentException("PROVISION_GRANT_NOT_YET_VALID")
    class GrantExpired : IllegalArgumentException("PROVISION_GRANT_EXPIRED")

    fun endpointAllowed(endpoint: SyncEndpoint) =
        allowedOrigin(endpoint.apiOrigin, BuildConfig.VISION_EXPERIMENT_ORIGIN) &&
            endpoint.mobileRoot.trimEnd('/') == endpoint.apiOrigin

    internal fun allowedOrigin(origin: String, experiment: String): Boolean =
        origin == API_ORIGIN || (experiment.isNotEmpty() &&
            Regex("https://[a-z0-9][a-z0-9-]*\\.onrender\\.com").matches(experiment) && origin == experiment)

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
            val file = File(filesDir, if (endpoint.apiOrigin == API_ORIGIN) ENROLLMENT_FILENAME else VISION_ENROLLMENT_FILENAME)
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
            expiresAt > notBefore &&
            expiresAt - issuedAt <= GRANT_MAX_TTL_MS)
        if (notBefore > at) throw GrantNotYetValid()
        if (expiresAt <= at) throw GrantExpired()
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
    /** Category of the last failed fetch, set before its callback runs; null after a success. Never a server message. */
    val lastFailure: ProvisionFailure? get() = null
    override fun close() {}
}

/** P22: why a grant request failed, in fixed categories. The server never says why it refused; the operator tool does. */
internal enum class ProvisionFailure {
    UNAUTHORIZED, FORBIDDEN, RATE_LIMITED, SERVER_UNAVAILABLE, REJECTED,
    TIMEOUT, NETWORK, TLS, RESPONSE_INVALID, CLOCK, ENROLLMENT_EXPIRED
}

/**
 * P22: what to do after a failed grant request. The same proof gets the same 401/403, so those are never retried
 * automatically: each retry only spends the server's per-proof budget (4 per minute) and hides the cause. Only a
 * service that is starting or unreachable is retried, three times with growing gaps; 429 waits once, longer.
 * An explicit action (service check, a new part request, reopening the screen) always starts afresh.
 */
internal object ProvisionRetryPolicy {
    const val TRANSIENT_ATTEMPTS = 3
    const val FIRST_GAP_MS = 30_000L
    const val RATE_LIMIT_GAP_MS = 120_000L
    /** Milliseconds until the next automatic try after [consecutive] failures in a row (1 = the first), or null for none. */
    fun nextDelayMs(failure: ProvisionFailure, consecutive: Int): Long? = when (failure) {
        ProvisionFailure.SERVER_UNAVAILABLE, ProvisionFailure.TIMEOUT, ProvisionFailure.NETWORK ->
            if (consecutive in 1..TRANSIENT_ATTEMPTS) FIRST_GAP_MS shl (consecutive - 1) else null
        ProvisionFailure.RATE_LIMITED -> if (consecutive == 1) RATE_LIMIT_GAP_MS else null
        else -> null
    }
    fun transient(failure: ProvisionFailure?) = failure == ProvisionFailure.SERVER_UNAVAILABLE ||
        failure == ProvisionFailure.TIMEOUT || failure == ProvisionFailure.NETWORK || failure == ProvisionFailure.RATE_LIMITED
}

/** Main-thread callbacks, worker-only I/O; trust store, TLS hostname and redirect policies are unchanged. */
internal class HttpsAvdSimulatorGrantExchange(
    private val endpoint: SyncEndpoint, private val enrollment: AvdSimulatorEnrollment,
    private val dispatcher: SyncCallbackDispatcher, private val now: () -> Long = System::currentTimeMillis,
    private val timeoutMs: Int = 5000,
    private val connections: (URI) -> HttpsURLConnection = { it.toURL().openConnection() as HttpsURLConnection },
    private val monotonicNanos: () -> Long = System::nanoTime,
    private val pause: (Long) -> Unit = Thread::sleep
) : AvdSimulatorGrantExchange {
    // Log only fixed diagnostic categories. Never log a proof, grant, URL with credentials or exception message.
    private val logTag = "CarScopeAvdAuth"
    private val uri = URI(endpoint.apiOrigin + "/simulator/provision")
    private val worker = Executors.newSingleThreadExecutor()
    private val deadlines = Executors.newSingleThreadScheduledExecutor()
    private val closed = AtomicBoolean(false)
    private val calls = java.util.concurrent.ConcurrentHashMap.newKeySet<Call>()
    @Volatile private var failure: ProvisionFailure? = null
    override val lastFailure: ProvisionFailure? get() = failure

    init { require(AvdSimulatorPolicy.endpointAllowed(endpoint) && timeoutMs in 1..10000) }

    private class HttpRejected(val status: Int) : Exception()
    private class HeadersRejected : Exception()

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
        val started = monotonicNanos()
        fun ensureActive() {
            if (call.completed.get() || closed.get()) throw InterruptedException()
            if (monotonicNanos() - started >= TimeUnit.MILLISECONDS.toNanos(timeoutMs.toLong()))
                throw SocketTimeoutException()
        }
        if (closed.get()) return call
        calls.add(call)
        fun finish(result: AvdSimulatorGrant?) {
            if (call.completed.compareAndSet(false, true)) dispatcher.post {
                if (!closed.get() && !call.cancelled.get()) callback(result)
            }
        }
        val timer = try {
            deadlines.schedule({
                if (call.completed.compareAndSet(false, true)) {
                    failure = ProvisionFailure.TIMEOUT
                    Log.w(logTag, "PROVISION_TIMEOUT")
                    dispatcher.post { if (!closed.get() && !call.cancelled.get()) callback(null) }
                    call.connection?.disconnect()
                }
            }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
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
                        if (status != 200) throw HttpRejected(status)
                        if (c.contentLengthLong > SyncHttpDecoder.MAX_BYTES ||
                            c.getHeaderField("Content-Encoding")?.let { it != "identity" } == true) {
                            throw HeadersRejected()
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
                        // Retain this exact response; waiting never issues another provision request.
                        val response = bytes.toByteArray()
                        val contentType = c.contentType
                        val validationStarted = monotonicNanos()
                        var waiting = false
                        while (true) {
                            ensureActive()
                            if (waiting && monotonicNanos() - validationStarted >= TimeUnit.SECONDS.toNanos(3))
                                throw AvdSimulatorPolicy.GrantNotYetValid()
                            try {
                                grant = AvdSimulatorPolicy.grant(response, contentType, endpoint,
                                    enrollment.registrationId, now())
                                ensureActive()
                                break
                            } catch (_: AvdSimulatorPolicy.GrantNotYetValid) {
                                waiting = true
                                pause(50)
                            }
                        }
                        failure = null
                        Log.i(logTag, "PROVISION_GRANT_VERIFIED")
                    } else {
                        if (!call.cancelled.get() && !closed.get()) failure = ProvisionFailure.ENROLLMENT_EXPIRED
                        Log.w(logTag, "PROVISION_ENROLLMENT_EXPIRED_OR_CANCELLED")
                    }
                } catch (e: Exception) {
                    grant = null
                    // Deliberately omit exception messages, stack traces, request/response bodies and token values.
                    failure = when (e) {
                        is HttpRejected -> when (e.status) {
                            401 -> ProvisionFailure.UNAUTHORIZED
                            403 -> ProvisionFailure.FORBIDDEN
                            429 -> ProvisionFailure.RATE_LIMITED
                            502, 503, 504 -> ProvisionFailure.SERVER_UNAVAILABLE
                            else -> ProvisionFailure.REJECTED
                        }
                        is HeadersRejected, is SyncHttpDecoder.Invalid -> ProvisionFailure.RESPONSE_INVALID
                        is SocketTimeoutException -> ProvisionFailure.TIMEOUT
                        is SSLException -> ProvisionFailure.TLS
                        is AvdSimulatorPolicy.GrantNotYetValid, is AvdSimulatorPolicy.GrantExpired -> ProvisionFailure.CLOCK
                        is IllegalArgumentException -> ProvisionFailure.RESPONSE_INVALID
                        is InterruptedException -> failure
                        else -> ProvisionFailure.NETWORK
                    }
                    val category = when (e) {
                        is HttpRejected -> when (e.status) {
                            401 -> "PROVISION_HTTP_UNAUTHORIZED"
                            403 -> "PROVISION_HTTP_FORBIDDEN"
                            429 -> "PROVISION_HTTP_RATE_LIMITED"
                            502, 503, 504 -> "PROVISION_SERVER_UNAVAILABLE"
                            else -> "PROVISION_HTTP_REJECTED"
                        }
                        is HeadersRejected -> "PROVISION_RESPONSE_HEADERS_REJECTED"
                        is SocketTimeoutException -> "PROVISION_TIMEOUT"
                        is SSLException -> "PROVISION_TLS_REJECTED"
                        is UnknownHostException -> "PROVISION_DNS_FAILURE"
                        is SyncHttpDecoder.Invalid -> "PROVISION_RESPONSE_INVALID_JSON"
                        is AvdSimulatorPolicy.GrantNotYetValid -> "PROVISION_GRANT_NOT_YET_VALID"
                        is AvdSimulatorPolicy.GrantExpired -> "PROVISION_GRANT_EXPIRED"
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
        var completed = false
        val started = try {
            exchange.fetch { grant -> synchronized(this) {
                if (!closed && generation == mine && !completed) {
                    completed = true
                    value = grant?.takeIf { it.expiresAt > now() }
                    pending = null
                    callback(value != null)
                }
            } }
        } catch (_: Exception) {
            if (!closed && generation == mine && !completed) { completed = true; callback(false) }
            return
        }
        if (closed || mine != generation) started.cancel() else if (!completed) pending = started
    }

    @Synchronized fun invalidate() {
        generation++; pending?.cancel(); pending = null; value = null
    }
    /** P22: the category of the last failed refresh, for the screen's retry decision. */
    fun lastFailure(): ProvisionFailure? = exchange.lastFailure
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
