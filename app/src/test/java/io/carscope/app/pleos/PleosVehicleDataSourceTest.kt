package io.carscope.app.pleos

import io.carscope.vehicle.*
import io.carscope.visualization.VehicleDiagramMapper
import org.junit.Assert.*
import org.junit.Test

class PleosVehicleDataSourceTest {
    private class Immediate : DoorDispatcher {
        override fun execute(action: () -> Unit) = action()
        override fun close() = Unit
    }

    private class Fake : DoorSession {
        val calls = mutableListOf<String>()
        var initializeError: Exception? = null
        lateinit var capabilityComplete: (DoorCapability) -> Unit
        lateinit var capabilityFailed: (Exception) -> Unit
        lateinit var readComplete: (Int?) -> Unit
        lateinit var readFailed: (Exception) -> Unit
        lateinit var event: (Int?) -> Unit
        lateinit var listenerFailed: (Exception) -> Unit
        override fun initialize() { calls += "initialize"; initializeError?.let { throw it } }
        override fun capability(complete: (DoorCapability) -> Unit, failed: (Exception) -> Unit) {
            calls += "capability"; capabilityComplete = complete; capabilityFailed = failed
        }
        override fun read(complete: (Int?) -> Unit, failed: (Exception) -> Unit) {
            calls += "read"; readComplete = complete; readFailed = failed
        }
        override fun subscribe(updated: (Int?) -> Unit, failed: (Exception) -> Unit) {
            calls += "subscribe"; event = updated; listenerFailed = failed
        }
        override fun unsubscribe() { calls += "unsubscribe" }
        override fun release() { calls += "release" }
        fun supported() = capabilityComplete(DoorCapability(true, 0, 1, "READ_WRITE"))
    }

    private fun source(fake: Fake, clock: () -> Long = { 100L }) =
        PleosVehicleDataSource({ fake }, Immediate(), clock)
    private fun PleosVehicleDataSource.front() = readSnapshot().doors.getValue(DoorId.FRONT_LEFT)
    private fun unavailable(reason: UnavailableReason) = Reading.Unavailable(reason)

    @Test fun verifiedBinaryEncodingMapsBothPositions() {
        assertEquals(Reading.Available(DoorPosition.CLOSED, 100L), mapDoorPosition(0, 0, 1, 100))
        assertEquals(Reading.Available(DoorPosition.OPEN, 101L), mapDoorPosition(1, 0, 1, 101))
    }

    @Test fun unknownNullAndOutOfRangeNeverBecomeClosed() {
        for (raw in listOf(null, -1, 2, Int.MAX_VALUE)) {
            assertEquals(unavailable(UnavailableReason.UNKNOWN), mapDoorPosition(raw, 0, 1, 100))
        }
    }

    @Test fun unverifiedRangesAreNotInterpreted() {
        for ((min, max) in listOf(null to null, 0 to 10, 1 to 0, 1 to 1)) {
            assertEquals(unavailable(UnavailableReason.UNKNOWN), mapDoorPosition(0, min, max, 100))
        }
    }

    @Test fun realOriginIsPreservedBeforeConnectionAndForUnimplementedDoors() {
        val source = source(Fake())
        assertEquals(DataOrigin.PLEOS, source.readSnapshot().origin)
        assertEquals(unavailable(UnavailableReason.DISCONNECTED), source.front())
        assertEquals(unavailable(UnavailableReason.UNSUPPORTED), source.readSnapshot().doors[DoorId.REAR_LEFT])
    }

    @Test fun failuresDoNotChangeMockOrReplaceRealWithMock() {
        val mock = MockVehicleDataSource().apply { scenario = MockScenario.FRONT_LEFT_OPEN }
        val fake = Fake(); val source = source(fake)
        source.start(); fake.capabilityFailed(Exception("service refused"))
        assertEquals(DataOrigin.PLEOS, source.readSnapshot().origin)
        assertEquals(unavailable(UnavailableReason.UNKNOWN), source.front())
        assertEquals(DataOrigin.MOCK, mock.readSnapshot().origin)
        assertEquals(DoorPosition.OPEN, (mock.readSnapshot().doors[DoorId.FRONT_LEFT] as Reading.Available).value)
    }

    @Test fun unreadableOrMissingAreaSkipsReadAndSubscription() {
        for (capability in listOf(DoorCapability(false, 0, 1, "WRITE"), DoorCapability(true, null, null, "READ"))) {
            val fake = Fake(); val source = source(fake)
            source.start(); fake.capabilityComplete(capability)
            assertEquals(unavailable(UnavailableReason.UNSUPPORTED), source.front())
            assertEquals(listOf("initialize", "capability"), fake.calls)
            source.close(); assertEquals("release", fake.calls.last())
        }
    }

    @Test fun nullCurrentReadingRemainsUnavailable() {
        val fake = Fake(); val source = source(fake)
        source.start(); fake.supported(); fake.readComplete(null)
        assertEquals(unavailable(UnavailableReason.UNKNOWN), source.front())
    }

    @Test fun failedReadAndListenerErrorsAreVisible() {
        val fake = Fake(); val source = source(fake)
        source.start(); fake.supported(); fake.readFailed(SecurityException("denied"))
        assertEquals(unavailable(UnavailableReason.PERMISSION_DENIED), source.front())
        fake.event(1); fake.listenerFailed(Exception("service error"))
        assertEquals(unavailable(UnavailableReason.UNKNOWN), source.front())
        assertTrue(source.status.contains("service error"))
    }

    @Test fun deniedInitializationIsReleasedWithoutAutomaticRetry() {
        val fake = Fake().apply { initializeError = SecurityException("CAR_DOORS") }
        val source = source(fake); source.start()
        assertEquals(unavailable(UnavailableReason.PERMISSION_DENIED), source.front())
        assertEquals(listOf("initialize", "release"), fake.calls)
    }

    @Test fun failedInitializationIsDisconnectedWithoutAutomaticRetry() {
        val fake = Fake().apply { initializeError = IllegalStateException("no service") }
        val source = source(fake); source.start()
        assertEquals(unavailable(UnavailableReason.DISCONNECTED), source.front())
        assertEquals(listOf("initialize", "release"), fake.calls)
    }

    @Test fun repeatedStartHasOneSessionAndOneSubscription() {
        val fake = Fake(); val source = source(fake)
        source.start(); source.start(); fake.supported(); source.start()
        assertEquals(1, fake.calls.count { it == "initialize" })
        assertEquals(1, fake.calls.count { it == "subscribe" })
    }

    @Test fun closeWaitsForCapabilityAndIgnoresItsLateResult() {
        val fake = Fake(); val source = source(fake)
        source.start(); source.close()
        assertFalse(fake.calls.contains("release"))
        fake.supported()
        assertEquals(listOf("initialize", "capability", "release"), fake.calls)
        assertEquals(unavailable(UnavailableReason.DISCONNECTED), source.front())
    }

    @Test fun unsubscribePrecedesReleaseWhichWaitsForRead() {
        val fake = Fake(); val source = source(fake)
        source.start(); fake.supported(); source.stop()
        assertEquals("unsubscribe", fake.calls.last())
        assertFalse(fake.calls.contains("release"))
        fake.readComplete(1)
        assertEquals("release", fake.calls.last())
        assertEquals(unavailable(UnavailableReason.DISCONNECTED), source.front())
    }

    @Test fun newerEventWinsOverDelayedInitialRead() {
        val fake = Fake(); val source = source(fake)
        source.start(); fake.supported(); fake.event(1); fake.readComplete(0)
        assertEquals(Reading.Available(DoorPosition.OPEN, 100L), source.front())
    }

    @Test fun duplicateCompletionDoesNotDuplicateSubscriptionsOrRelease() {
        val fake = Fake(); val source = source(fake)
        source.start(); fake.supported(); fake.supported(); fake.readComplete(0); fake.readComplete(1)
        source.stop(); source.stop(); source.close()
        assertEquals(1, fake.calls.count { it == "subscribe" })
        assertEquals(1, fake.calls.count { it == "unsubscribe" })
        assertEquals(1, fake.calls.count { it == "release" })
    }

    @Test fun duplicateValueEventsAreNewObservationsWithoutNewSubscriptions() {
        var time = 100L
        val fake = Fake(); val source = source(fake) { time }
        source.start(); fake.supported(); fake.readComplete(0); fake.event(1)
        time = 200; fake.event(1)
        assertEquals(Reading.Available(DoorPosition.OPEN, 200L), source.front())
        assertEquals(1, fake.calls.count { it == "subscribe" })
    }

    @Test fun stopThenStartWaitsForOldRequestBeforeOpeningNextSession() {
        val old = Fake(); val next = Fake(); val queue = ArrayDeque(listOf(old, next))
        val source = PleosVehicleDataSource({ queue.removeFirst() }, Immediate())
        source.start(); source.stop(); source.start()
        assertTrue(next.calls.isEmpty())
        old.supported()
        assertEquals("release", old.calls.last())
        assertEquals(listOf("initialize", "capability"), next.calls)
    }

    @Test fun recreatedOwnerIgnoresOldCallbacksAndClosesOldSession() {
        val old = Fake(); val previous = source(old)
        previous.start(); old.supported(); previous.close()
        val fresh = Fake(); val recreated = source(fresh)
        recreated.start(); fresh.supported(); fresh.readComplete(0)
        old.event(1); old.readComplete(1)
        assertEquals("release", old.calls.last())
        assertEquals(unavailable(UnavailableReason.DISCONNECTED), previous.front())
        assertEquals(Reading.Available(DoorPosition.CLOSED, 100L), recreated.front())
    }

    @Test fun pollingCacheNeverRefreshesObservationTimestamp() {
        var time = 100L
        val fake = Fake(); val source = source(fake) { time }
        source.start(); fake.supported(); fake.readComplete(1)
        time = 6_000
        val snapshot = source.readSnapshot()
        assertEquals(100L, (source.front() as Reading.Available).observedAtMillis)
        assertEquals("STALE", VehicleDiagramMapper.map(snapshot, time).doors.getValue(DoorId.FRONT_LEFT).name)
    }
}
