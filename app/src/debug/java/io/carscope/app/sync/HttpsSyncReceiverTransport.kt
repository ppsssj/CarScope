package io.carscope.app.sync

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.SocketTimeoutException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Future
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

internal class SyncEndpoint(apiOrigin: String, mobileRoot: String) {
    val apiOrigin: String = safeRoot(apiOrigin).trimEnd('/')
    val mobileRoot: String = safeRoot(mobileRoot)
    init {
        for (origin in listOf(this.apiOrigin, this.mobileRoot)) {
            val uri = URI(origin); require(uri.port == -1 || uri.port in 1..65535)
            require(uri.host.all { it.code in 33..126 })
        }
    }
    override fun toString(): String = "SyncEndpoint(configured)"
    companion object {
        private fun safeRoot(value: String): String = try { requireHttpsMobileRoot(value) } catch (_: Exception) { throw IllegalArgumentException("INVALID_SYNC_ENDPOINT") }
    }
}
internal class SessionCreationCredential(private val value: String) {
    init { require(Regex("[A-Za-z0-9_-]{32,128}").matches(value)) }
    fun authorizationValue(): String = value
    override fun toString(): String = "SessionCreationCredential(REDACTED)"
}
internal fun interface SessionCreationCredentialProvider { fun credential(endpoint: SyncEndpoint): SessionCreationCredential? }
internal class DenyByDefaultCredentialProvider : SessionCreationCredentialProvider {
    override fun credential(endpoint: SyncEndpoint): SessionCreationCredential? = null
}
internal fun interface SyncCallbackDispatcher { fun post(action: () -> Unit) }
internal interface ConnectedSyncReceiverTransport : SyncReceiverTransport, AutoCloseable {
    fun checkConnection(callback: (SyncReply<Unit>) -> Unit): SyncCancellation
    fun creationAuthorized(): Boolean
}

/** Platform trust/hostname checks remain enabled. No global TLS settings, redirects, body logs or automatic writes. */
internal class HttpsSyncReceiverTransport(
    private val endpoint: SyncEndpoint,
    private val credentials: SessionCreationCredentialProvider,
    private val dispatcher: SyncCallbackDispatcher,
    private val connectTimeoutMs: Int = 5000,
    private val readTimeoutMs: Int = 8000,
    private val connections: (URI) -> HttpsURLConnection = { it.toURL().openConnection() as HttpsURLConnection }
) : ConnectedSyncReceiverTransport {
    private val closed = AtomicBoolean(false)
    private val executor = ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(8), { task -> Thread(task, "carscope-sync-https").apply { isDaemon = true } })
    private val active = ConcurrentHashMap.newKeySet<Call>()
    private val expiries = ConcurrentHashMap<String, Long>()
    private class Call : SyncCancellation {
        val cancelled = AtomicBoolean(false)
        @Volatile var connection: HttpsURLConnection? = null
        @Volatile var future: Future<*>? = null
        override fun cancel() { cancelled.set(true); connection?.disconnect(); future?.cancel(true) }
    }
    init { require(connectTimeoutMs > 0 && readTimeoutMs > 0) }
    override fun creationAuthorized(): Boolean = try { !closed.get() && credentials.credential(endpoint) != null } catch (_: Exception) { false }

    private fun <T> submit(callback: (SyncReply<T>) -> Unit, work: (Call) -> SyncReply<T>): SyncCancellation {
        val call = Call()
        if (closed.get()) return call
        active.add(call)
        try {
            call.future = executor.submit {
                val reply = try { work(call) }
                catch (_: SocketTimeoutException) { SyncReply.Failure(SyncFailure.TIMEOUT) }
                catch (_: SyncHttpDecoder.Invalid) { SyncReply.Failure(SyncFailure.INVALID) }
                catch (_: Exception) { SyncReply.Failure(SyncFailure.NETWORK) }
                finally { call.connection?.disconnect(); call.connection = null }
                dispatcher.post {
                    try { if (!closed.get() && !call.cancelled.get()) callback(reply) }
                    finally { active.remove(call) }
                }
            }
        } catch (_: Exception) {
            active.remove(call)
            dispatcher.post { if (!closed.get() && !call.cancelled.get()) callback(SyncReply.Failure(SyncFailure.SERVER)) }
        }
        if (closed.get()) call.cancel()
        return SyncCancellation { call.cancel(); active.remove(call) }
    }
    private data class Response(val status: Int, val bytes: ByteArray, val type: String?)
    private fun request(call: Call, method: String, path: String, bearer: String?, body: String? = null): Response {
        if (call.cancelled.get() || closed.get()) throw InterruptedException()
        val uri = URI(endpoint.apiOrigin + path)
        require(uri.scheme == "https" && uri.rawAuthority == URI(endpoint.apiOrigin).rawAuthority && uri.rawQuery == null && uri.rawFragment == null)
        val bytes = body?.toByteArray(Charsets.UTF_8)
        if (bytes != null && bytes.size > SyncHttpDecoder.MAX_BYTES) throw SyncHttpDecoder.Invalid()
        val connection = connections(uri); call.connection = connection
        if (call.cancelled.get() || closed.get()) { connection.disconnect(); throw InterruptedException() }
        connection.requestMethod = method; connection.instanceFollowRedirects = false; connection.useCaches = false
        connection.connectTimeout = connectTimeoutMs; connection.readTimeout = readTimeoutMs
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Cache-Control", "no-store")
        if (bearer != null) {
            require(Regex("[A-Za-z0-9_-]{32,128}").matches(bearer))
            connection.setRequestProperty("Authorization", "Bearer $bearer")
        }
        if (bytes != null) {
            connection.doOutput = true; connection.setFixedLengthStreamingMode(bytes.size)
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(bytes) }
        }
        val status = connection.responseCode
        if (status in 300..399) throw SyncHttpDecoder.Invalid()
        if (connection.contentLengthLong > SyncHttpDecoder.MAX_BYTES || connection.getHeaderField("Content-Encoding")?.let { it != "identity" } == true) throw SyncHttpDecoder.Invalid()
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val output = ByteArrayOutputStream()
        (stream ?: throw SyncHttpDecoder.Invalid()).use { input ->
            val buffer = ByteArray(2048)
            while (true) {
                if (call.cancelled.get() || closed.get()) throw InterruptedException()
                val count = input.read(buffer); if (count < 0) break
                if (output.size() + count > SyncHttpDecoder.MAX_BYTES) throw SyncHttpDecoder.Invalid()
                output.write(buffer, 0, count)
            }
        }
        return Response(status, output.toByteArray(), connection.contentType)
    }
    override fun create(callback: (SyncReply<CreatedSyncSession>) -> Unit): SyncCancellation = submit(callback) { call ->
        val credential = credentials.credential(endpoint) ?: return@submit SyncReply.Failure(SyncFailure.UNAUTHORIZED)
        val r = request(call, "POST", "/v1/sessions", credential.authorizationValue(), "{\"taskId\":\"washer-fluid\"}")
        if (r.status != 201) SyncReply.Failure(SyncHttpDecoder.error(r.bytes, r.type, r.status))
        else {
            val created = SyncHttpDecoder.created(r.bytes, r.type); expiries[created.sessionId] = created.expiresAt
            SyncReply.Success(created)
        }
    }
    private fun sessionPath(id: String): String {
        if (!Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}").matches(id)) throw SyncHttpDecoder.Invalid()
        return "/v1/sessions/$id"
    }
    private fun session(method: String, id: String, receiver: ReceiverCredential, suffix: String, body: String?, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation = submit(callback) { call ->
        if (!receiver.valid()) return@submit SyncReply.Failure(SyncFailure.UNAUTHORIZED)
        val r = request(call, method, sessionPath(id) + suffix, receiver.authorizationValue(), body)
        if (r.status != 200) SyncReply.Failure(SyncHttpDecoder.error(r.bytes, r.type, r.status))
        else {
            val view = if (suffix == "/cancel") SyncHttpDecoder.cancelled(r.bytes, r.type, id, expiries[id] ?: throw SyncHttpDecoder.Invalid()) else SyncHttpDecoder.view(r.bytes, r.type)
            if (view.sessionId != id) throw SyncHttpDecoder.Invalid()
            if (suffix == "/accept" && view.sessionState != SyncSessionState.ACCEPTED) throw SyncHttpDecoder.Invalid()
            expiries[id] = view.expiresAt; SyncReply.Success(view)
        }
    }
    override fun view(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit) = session("GET", id, receiver, "", null, callback)
    override fun accept(id: String, receiver: ReceiverCredential, digest: String, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
        if (!Regex("sha256:[0-9a-f]{64}").matches(digest)) return submit(callback) { SyncReply.Failure(SyncFailure.INVALID) }
        return session("POST", id, receiver, "/accept", "{\"resultDigest\":\"$digest\"}", callback)
    }
    override fun cancel(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit) = session("POST", id, receiver, "/cancel", null, callback)
    override fun checkConnection(callback: (SyncReply<Unit>) -> Unit): SyncCancellation = submit(callback) { call ->
        val r = request(call, "GET", "/v1/sessions/00000000-0000-4000-8000-000000000000", null)
        if (r.status == 401 && SyncHttpDecoder.error(r.bytes, r.type, r.status) == SyncFailure.UNAUTHORIZED) SyncReply.Success(Unit)
        else SyncReply.Failure(SyncFailure.INVALID)
    }
    override fun close() { if (closed.compareAndSet(false, true)) { active.forEach { it.cancel() }; active.clear(); expiries.clear(); executor.shutdownNow() } }
}
