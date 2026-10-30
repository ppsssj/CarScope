package io.carscope.vehicle

enum class MockScenario { ALL_CLOSED, FRONT_LEFT_OPEN, UNAVAILABLE }

/** Deterministic scenarios. Does not import or connect to a Pleos service. */
class MockVehicleDataSource(
    private val clockMillis: () -> Long = System::currentTimeMillis,
) : VehicleDataSource {
    var scenario: MockScenario = MockScenario.ALL_CLOSED

    override fun readSnapshot(): VehicleSnapshot {
        val observedAt = clockMillis()
        val selectedScenario = scenario
        return VehicleSnapshot(
            origin = DataOrigin.MOCK,
            doors = DoorId.entries.associateWith { door ->
                when {
                    selectedScenario == MockScenario.UNAVAILABLE ->
                        Reading.Unavailable(UnavailableReason.DISCONNECTED)
                    selectedScenario == MockScenario.FRONT_LEFT_OPEN && door == DoorId.FRONT_LEFT ->
                        Reading.Available(DoorPosition.OPEN, observedAt)
                    else -> Reading.Available(DoorPosition.CLOSED, observedAt)
                }
            },
        )
    }
}
