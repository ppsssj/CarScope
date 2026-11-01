package io.carscope.app.sync

import org.junit.Assert.*
import org.junit.Test

class SyncReceiverTest {
    private val id = "12345678-1234-4123-8123-123456789abc"
    private val token = "R".repeat(43)
    private val invite = "I".repeat(43)
    private val result = CompletedInspection(id, "2026-11-01T09:00:00.000Z", "2026-11-01T09:01:00.000Z", ReportedStatus.NEEDS_REFILL, false, true)
    private class Timer : SyncReceiverScheduler {
        val tasks = mutableListOf<() -> Unit>()
        val delays = mutableListOf<Long>()
        override fun after(delayMs: Long, action: () -> Unit): SyncCancellation {
            tasks.add(action); delays.add(delayMs); return SyncCancellation { tasks.remove(action) }
        }
        fun next() { tasks.removeAt(0).invoke() }
    }
    private inner class Transport : SyncReceiverTransport {
        var creates = 0; var views = 0; var accepts = 0; var cancels = 0; var cancelledRequests = 0
        var createReply: SyncReply<CreatedSyncSession> = SyncReply.Success(CreatedSyncSession(id, ReceiverCredential(token), InviteCredential(invite), 2000, 3000))
        var reply: SyncReply<SyncReceiverView> = SyncReply.Success(view(SyncSessionState.CLAIMED))
        var defer = false
        var later: (() -> Unit)? = null
        var acceptedDigest: String? = null
        var usedCredential: ReceiverCredential? = null
        private fun <T> respond(value: SyncReply<T>, callback: (SyncReply<T>) -> Unit): SyncCancellation {
            if (defer) later = { callback(value) } else callback(value)
            return SyncCancellation { cancelledRequests++ } // late callbacks deliberately still possible
        }
        override fun create(callback: (SyncReply<CreatedSyncSession>) -> Unit): SyncCancellation { creates++; return respond(createReply, callback) }
        override fun view(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
            views++; usedCredential = receiver; return respond(reply, callback)
        }
        override fun accept(id: String, receiver: ReceiverCredential, digest: String, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
            accepts++; acceptedDigest = digest; return respond(reply, callback)
        }
        override fun cancel(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
            cancels++; return respond(reply, callback)
        }
    }
    private fun view(phase: SyncSessionState, value: CompletedInspection? = null, digest: String? = value?.digest()) = SyncReceiverView(id, phase, 3000, value, digest)
    private inner class Fixture {
        var now = 1000L
        val transport = Transport(); val timer = Timer(); val changes = mutableListOf<SyncReceiverState>()
        val client = SyncReceiverClient(transport) { now }
        val owner = SyncReceiverController(client, timer, changes::add)
        fun start() = owner.create("https://mobile.example/")
        fun submitted() { start(); transport.reply = SyncReply.Success(view(SyncSessionState.RESULT_SUBMITTED, result)); owner.poll() }
    }

    @Test fun `canonical digest matches Node protocol golden record`() {
        assertTrue(result.valid())
        assertEquals("sha256:4ab36ad950704e07554f67234a7948fbb58b6f1cb6a36971cdc13deab222f3ff", result.digest())
        assertFalse(result.copy(completedAt = "2020-01-01T00:00:00.000Z").valid())
        assertFalse(result.copy(inspectionId = "VIN-secret").valid())
    }
    @Test fun `creation keeps receiver credential out of QR and diagnostics`() {
        val f = Fixture(); f.start()
        assertEquals(ReceiverPhase.WAITING, f.owner.state.phase)
        val qr = f.owner.state.qr!!.value
        assertEquals("https://mobile.example/#v=2&task=washer-fluid&invite=$invite", qr)
        assertFalse(qr.contains(token))
        assertFalse(f.owner.state.toString().contains(invite))
        assertFalse(ReceiverCredential(token).toString().contains(token))
        assertFalse(f.transport.createReply.toString().contains(token))
        f.owner.poll(); assertEquals(token, f.transport.usedCredential!!.authorizationValue())
    }
    @Test fun `HTTPS only root rejects cleartext credentials query and fragment`() {
        for (url in listOf("http://mobile.example/", "https://user:pass@mobile.example/", "https://mobile.example/?token=x", "https://mobile.example/#invite=x", "https://mobile.example/path")) {
            try { requireHttpsMobileRoot(url); fail(url) } catch (_: IllegalArgumentException) {}
        }
    }
    @Test fun `submitted result remains waiting until explicit exact digest accept`() {
        val f = Fixture(); f.submitted()
        assertTrue(f.owner.state.canAccept); assertEquals(0, f.transport.accepts)
        assertTrue(f.owner.state.summary().contains("사용자 보고")); assertTrue(f.owner.state.summary().contains("센서 진단이 아닙니다"))
        f.transport.reply = SyncReply.Success(view(SyncSessionState.ACCEPTED, result)); f.owner.accept()
        assertEquals(result.digest(), f.transport.acceptedDigest)
        assertEquals(ReceiverPhase.ACCEPTED, f.owner.state.phase); assertTrue(f.timer.tasks.isEmpty())
        f.owner.accept(); f.owner.cancel(); f.owner.poll(); assertEquals(1, f.transport.accepts); assertEquals(0, f.transport.cancels)
    }
    @Test fun `cancel deletes displayed result and stops polling`() {
        val f = Fixture(); f.submitted(); f.transport.reply = SyncReply.Success(view(SyncSessionState.CANCELLED)); f.owner.cancel()
        assertEquals(ReceiverPhase.CANCELLED, f.owner.state.phase); assertNull(f.owner.state.result); assertNull(f.owner.state.qr)
        assertTrue(f.timer.tasks.isEmpty()); f.owner.cancel(); assertEquals(1, f.transport.cancels)
    }
    @Test fun `duplicate create accept and cancel blocked while request pending`() {
        val f = Fixture(); f.transport.defer = true; f.start(); f.start(); assertEquals(1, f.transport.creates)
        f.transport.later!!(); f.transport.defer = false
        f.transport.reply = SyncReply.Success(view(SyncSessionState.RESULT_SUBMITTED, result)); f.owner.poll()
        f.transport.defer = true; f.transport.reply = SyncReply.Success(view(SyncSessionState.ACCEPTED, result))
        f.owner.accept(); f.owner.accept(); f.owner.cancel(); assertEquals(1, f.transport.accepts); assertEquals(0, f.transport.cancels)
        f.transport.later!!(); assertEquals(ReceiverPhase.ACCEPTED, f.owner.state.phase)
    }
    @Test fun `Activity stop invalidates late creation and recreated owner starts fresh`() {
        val f = Fixture(); f.transport.defer = true; f.start(); val old = f.transport.later!!
        f.owner.close(); old(); assertEquals(ReceiverPhase.CLOSED, f.owner.state.phase); assertNull(f.owner.state.qr)
        val fresh = SyncReceiverController(SyncReceiverClient(f.transport) { f.now }, f.timer) {}
        assertEquals(ReceiverPhase.IDLE, fresh.state.phase); assertTrue(f.transport.cancelledRequests > 0)
    }
    @Test fun `late view or accept cannot update closed Activity owner`() {
        val f = Fixture(); f.submitted(); f.transport.defer = true; f.transport.reply = SyncReply.Success(view(SyncSessionState.ACCEPTED, result))
        f.owner.accept(); val old = f.transport.later!!; f.owner.close(); old()
        assertEquals(ReceiverPhase.CLOSED, f.owner.state.phase); assertNull(f.owner.state.result)
    }
    @Test fun `expiry refuses existing token before transport call and needs new session`() {
        val f = Fixture(); f.start(); f.now = 3001; f.owner.poll()
        assertEquals(ReceiverPhase.EXPIRED, f.owner.state.phase); assertEquals(0, f.transport.views)
        f.owner.accept(); assertEquals(0, f.transport.accepts); assertTrue(f.timer.tasks.isEmpty())
    }
    @Test fun `server expiry distinct from cancel`() {
        val f = Fixture(); f.start(); f.transport.reply = SyncReply.Success(view(SyncSessionState.EXPIRED)); f.owner.poll()
        assertEquals(ReceiverPhase.EXPIRED, f.owner.state.phase)
    }
    @Test fun `wrong digest wrong session and missing submitted result fail closed`() {
        for (bad in listOf(view(SyncSessionState.RESULT_SUBMITTED, result, "sha256:wrong"), view(SyncSessionState.RESULT_SUBMITTED, result).copy(sessionId = "wrong"), view(SyncSessionState.RESULT_SUBMITTED), view(SyncSessionState.ACCEPTED))) {
            val f = Fixture(); f.start(); f.transport.reply = SyncReply.Success(bad); f.owner.poll()
            assertEquals(ReceiverPhase.FAILED, f.owner.state.phase); assertEquals(SyncFailure.INVALID, f.owner.state.failure)
            assertFalse(f.owner.state.canAccept)
        }
    }
    @Test fun `accept response must confirm exactly shown digest and accepted state`() {
        val f = Fixture(); f.submitted(); f.transport.reply = SyncReply.Success(view(SyncSessionState.RESULT_SUBMITTED, result)); f.owner.accept()
        assertEquals(ReceiverPhase.FAILED, f.owner.state.phase)
    }
    @Test fun `network timeout rate limit server failure bounded polling and manual retry`() {
        for (error in listOf(SyncFailure.NETWORK, SyncFailure.TIMEOUT, SyncFailure.RATE_LIMITED, SyncFailure.SERVER)) {
            val f = Fixture(); f.start(); f.transport.reply = SyncReply.Failure(error)
            f.timer.next(); f.timer.next(); f.timer.next()
            assertEquals(3, f.transport.views); assertTrue(f.timer.tasks.isEmpty()); assertTrue(f.owner.state.retryAvailable)
            assertEquals(listOf(2000L, 4000L, 8000L), f.timer.delays)
            f.transport.reply = SyncReply.Success(view(SyncSessionState.CLAIMED)); f.owner.retryPolling()
            assertNull(f.owner.state.failure); assertTrue(f.timer.tasks.isNotEmpty())
        }
    }
    @Test fun `authorization and conflict failure never switch to fake or success`() {
        for (error in listOf(SyncFailure.UNAUTHORIZED, SyncFailure.CONFLICT)) {
            val f = Fixture(); f.start(); f.transport.reply = SyncReply.Failure(error); f.owner.poll()
            assertEquals(ReceiverPhase.FAILED, f.owner.state.phase); assertEquals(error, f.owner.state.failure); assertTrue(f.timer.tasks.isEmpty())
        }
    }
    @Test fun `creation refusal stays failure without issuing QR`() {
        val f = Fixture(); f.transport.createReply = SyncReply.Failure(SyncFailure.UNAUTHORIZED); f.start()
        assertEquals(ReceiverPhase.FAILED, f.owner.state.phase); assertNull(f.owner.state.qr)
    }
    @Test fun `submitted result cannot regress or be replaced on later poll`() {
        for (bad in listOf(view(SyncSessionState.CLAIMED), view(SyncSessionState.RESULT_SUBMITTED, result.copy(status = ReportedStatus.OK)))) {
            val f = Fixture(); f.submitted(); f.transport.reply = SyncReply.Success(bad); f.owner.poll()
            assertEquals(ReceiverPhase.FAILED, f.owner.state.phase); assertFalse(f.owner.state.canAccept)
        }
    }
    @Test fun `closing from a render callback prevents creating an orphan credential`() {
        val f = Fixture()
        lateinit var owner: SyncReceiverController
        owner = SyncReceiverController(f.client, f.timer) { if (it.phase == ReceiverPhase.CREATING) owner.close() }
        owner.create("https://mobile.example/")
        assertEquals(ReceiverPhase.CLOSED, owner.state.phase); assertEquals(0, f.transport.creates)
    }
}
