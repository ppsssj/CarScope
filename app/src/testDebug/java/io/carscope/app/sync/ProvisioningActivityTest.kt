package io.carscope.app.sync

import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

class ProvisioningFixtureActivity : SyncReceiverActivity() {
    internal var clock = 1000L
    internal val exchange = PendingProvisioningExchange()
    override fun endpoint() = ProvisioningSamples.endpoint
    override fun now() = clock
    override fun newProvisioningSource(endpoint: SyncEndpoint, dispatcher: SyncCallbackDispatcher) =
        RefreshingProvisionedCredentialSource(endpoint, ProvisioningSamples.issuer, ProvisioningSamples.audience, exchange) { clock }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ProvisioningActivityTest {
    private fun button(a: SyncReceiverActivity) = a.findViewById<ViewGroup>(android.R.id.content).findViewWithTag<Button>("create")
    @Test fun `trusted code hook alone can refresh creation permission and expiry disables it without network creation`() {
        val b = Robolectric.buildActivity(ProvisioningFixtureActivity::class.java).setup(); val a = b.get()
        assertFalse(button(a).isEnabled); assertEquals(1, a.exchange.callbacks.size)
        a.exchange.callbacks.last()(ProvisioningSamples.lease()); assertTrue(button(a).isEnabled)
        a.clock = 2000; shadowOf(Looper.getMainLooper()).idleFor(1, TimeUnit.SECONDS); assertFalse(button(a).isEnabled)
        b.pause().stop().destroy(); assertEquals(1, a.exchange.closes)
    }
    @Test fun `stopped Activity and new instance cannot receive previous provisioning result`() {
        val old = Robolectric.buildActivity(ProvisioningFixtureActivity::class.java).setup(); val callback = old.get().exchange.callbacks.last()
        old.pause().stop().destroy()
        val fresh = Robolectric.buildActivity(ProvisioningFixtureActivity::class.java).setup()
        callback(ProvisioningSamples.lease()); assertFalse(button(fresh.get()).isEnabled)
        fresh.pause().stop().destroy()
    }
}
