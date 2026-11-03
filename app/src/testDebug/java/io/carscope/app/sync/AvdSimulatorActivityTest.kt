package io.carscope.app.sync

import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

class AvdSimulatorFixtureActivity : SyncReceiverActivity() {
    internal var clock = 2100L
    internal val exchange = PendingAvdSimulatorExchange()
    override fun endpoint() = AvdSimulatorSamples.endpoint
    override fun now() = clock
    // Use an in-memory transport: Robolectric lifecycle tests must never call public Render.
    override fun newTransport(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher): ConnectedSyncReceiverTransport =
        object : ConnectedSyncReceiverTransport {
            override fun creationAuthorized() = credentialProvider().credential(endpoint) != null
            override fun checkConnection(callback: (SyncReply<Unit>) -> Unit): SyncCancellation {
                callback(SyncReply.Success(Unit)); return SyncCancellation {}
            }
            override fun create(callback: (SyncReply<CreatedSyncSession>) -> Unit): SyncCancellation {
                callback(SyncReply.Failure(SyncFailure.UNAUTHORIZED)); return SyncCancellation {}
            }
            override fun view(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
                callback(SyncReply.Failure(SyncFailure.UNAUTHORIZED)); return SyncCancellation {}
            }
            override fun accept(id: String, receiver: ReceiverCredential, digest: String, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
                callback(SyncReply.Failure(SyncFailure.UNAUTHORIZED)); return SyncCancellation {}
            }
            override fun cancel(id: String, receiver: ReceiverCredential, callback: (SyncReply<SyncReceiverView>) -> Unit): SyncCancellation {
                callback(SyncReply.Failure(SyncFailure.UNAUTHORIZED)); return SyncCancellation {}
            }
            override fun close() {}
        }
    override fun newAvdSimulatorSource(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher) =
        RefreshingAvdSimulatorCredentialSource(endpoint, exchange) { clock }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class AvdSimulatorActivityTest {
    private fun <T : android.view.View> view(a: SyncReceiverActivity, tag: String): T =
        a.findViewById<ViewGroup>(android.R.id.content).findViewWithTag(tag)
    private fun create(a: SyncReceiverActivity): Button = view(a, "create")
    private fun note(a: SyncReceiverActivity): String = view<TextView>(a, "authentication").text.toString()

    @Test fun `no creation until operator AVD grant, expiry fails closed without user or OEM identity`() {
        val b = Robolectric.buildActivity(AvdSimulatorFixtureActivity::class.java).setup()
        val a = b.get()
        assertFalse(create(a).isEnabled)
        assertEquals(1, a.exchange.callbacks.size)
        assertTrue(note(a).contains("시뮬레이션"))
        assertTrue(note(a).contains("실제 차량"))
        assertFalse(note(a).contains("ownershipVerified=true"))
        a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        assertTrue(create(a).isEnabled)
        a.clock = 122000
        shadowOf(Looper.getMainLooper()).idleFor(1,TimeUnit.SECONDS)
        assertFalse(create(a).isEnabled)
        b.pause().stop().destroy()
        assertEquals(1,a.exchange.closes)
    }

    @Test fun `manual service check invalidates old grant and stale Activity cannot reauthorize`() {
        val old = Robolectric.buildActivity(AvdSimulatorFixtureActivity::class.java).setup()
        val a = old.get()
        a.exchange.callbacks.last()(AvdSimulatorSamples.value())
        assertTrue(create(a).isEnabled)
        // Pressing probe triggers explicit credential refresh first, never auto-creates a QR session.
        view<Button>(a,"probe").performClick()
        assertFalse(create(a).isEnabled)
        val late = a.exchange.callbacks.last()
        old.pause().stop().destroy()
        late(AvdSimulatorSamples.value())
        assertFalse(create(a).isEnabled)
        val fresh = Robolectric.buildActivity(AvdSimulatorFixtureActivity::class.java).setup()
        assertFalse(create(fresh.get()).isEnabled)
        fresh.pause().stop().destroy()
    }
}
