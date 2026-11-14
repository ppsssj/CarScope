package io.carscope.app.tire

import android.content.Context
import android.util.Log

/** Both debug Activities share this owner. Application context only; no Activity/lease is retained here. */
internal object TireProcessOwner {
    private var owner: TireProbeOwner? = null
    @Synchronized fun get(context: Context): TireProbeOwner {
        val app = context.applicationContext
        return owner ?: TireProbeOwner(PleosTireDataSource({ SdkTireSession(app) }, log = { Log.i("CarScopeTire", it) }))
            .also { owner = it }
    }
}
