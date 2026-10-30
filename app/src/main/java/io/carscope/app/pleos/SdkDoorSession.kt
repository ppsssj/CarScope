package io.carscope.app.pleos

import android.content.Context
import android.content.pm.PackageManager
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.Door
import ai.pleos.playground.vehicle.api.model.area.DoorArea
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.constant.area.DoorValue
import ai.pleos.playground.vehicle.listener.DoorPositionListener

/** Typed SDK 2.3.2 calls only. No SET/control API or reflection is used. */
internal class SdkDoorSession(private val context: Context) : DoorSession {
    private val vehicle = Vehicle(context.applicationContext)
    private val area = DoorArea(DoorValue.ROW_1_LEFT)
    private lateinit var door: Door
    private var listener: DoorPositionListener? = null

    override fun initialize() {
        if (context.checkSelfPermission("pleos.car.permission.CAR_DOORS") != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("CAR_DOORS not granted")
        }
        vehicle.initialize()
        door = vehicle.getDoor()
    }

    override fun capability(complete: (DoorCapability) -> Unit, failed: (Exception) -> Unit) {
        door.checkDoorPositionCapabilities(
            onComplete = { config, bounds ->
                val selected = bounds[area]
                complete(DoorCapability(
                    config.accessType == AccessType.READ || config.accessType == AccessType.READ_WRITE,
                    selected?.minValue, selected?.maxValue, config.accessType.name,
                ))
            },
            onFailed = failed,
        )
    }

    override fun read(complete: (Int?) -> Unit, failed: (Exception) -> Unit) {
        door.getCurrentDoorPosition(area = area, onComplete = complete, onFailed = failed)
    }

    override fun subscribe(updated: (Int?) -> Unit, failed: (Exception) -> Unit) {
        check(listener == null) { "Door listener already registered" }
        val registered = object : DoorPositionListener {
            override fun onPositionUpdated(pos: Int?) = updated(pos)
            override fun onFailed(e: Exception) = failed(e)
        }
        listener = registered
        door.registerDoorPosition(area, registered)
    }

    override fun unsubscribe() {
        listener?.let { registered ->
            door.unregisterDoorPosition(area, registered)
            listener = null
        }
    }

    override fun release() = vehicle.release()
}
