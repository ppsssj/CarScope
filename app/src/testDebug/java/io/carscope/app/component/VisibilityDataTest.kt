package io.carscope.app.component

import ai.pleos.playground.vehicle.api.model.area.WindowArea
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig
import ai.pleos.playground.vehicle.constant.area.WindowValue
import ai.pleos.playground.vehicle.constant.control.WiperState
import ai.pleos.playground.vehicle.constant.control.LightState
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class VisibilityDataTest {
    @Test fun `unavailable vehicle service initialization remains an error cache rather than an app exit or mock`() {
        val worker=ComponentTestWorker();val sdk=ComponentFakeSession().apply{initFails=true};val source=PleosComponentDataSource({sdk},worker,{1000})
        source.start();worker.drain();assertTrue(source.readSnapshot().readings.values.all{it.availabilityStatus==ComponentStatus.ERROR&&it.source=="PLEOS"&&it.value==null})
        assertTrue(sdk.capabilities.isEmpty());assertEquals(1,sdk.released);source.close();worker.drain();assertEquals("CLOSED",source.diagnostics.phase)
    }
    private class Fixture {
        val worker=ComponentTestWorker(); val sdk=ComponentFakeSession(); var at=1000L
        val source=PleosComponentDataSource({sdk},worker,{at}); val channel=ComponentUiChannel(ComponentOwner(source))
        init { channel.start();worker.drain() }
        fun cap(f: ComponentFeature, cap: ComponentCapability?=ComponentCapability(true,testComponentValues(f))) { sdk.capabilities.getValue(f).first(cap);worker.drain() }
        fun event(f: ComponentFeature,v: ComponentValue?) { sdk.events.getValue(f).first(v);worker.drain() }
        fun row(f: ComponentFeature)=source.readSnapshot().readings.getValue(f)
    }
    @Test fun `public permission area and enum contracts are exact without combined area guessing`() {
        assertEquals("pleos.car.permission.CAR_WINDOWS",componentReadPermission(ComponentFeature.WIPER_FRONT))
        assertEquals("pleos.car.permission.CAR_LIGHTS",componentReadPermission(ComponentFeature.LOW_BEAM));assertEquals(componentReadPermission(ComponentFeature.LOW_BEAM),componentReadPermission(ComponentFeature.HIGH_BEAM))
        assertEquals(WIPER_STATES,WiperState.entries.map{it.name}.toSet());assertEquals(LIGHT_STATES,LightState.entries.map{it.name}.toSet())
        val read=CapabilityConfig(AccessType.READ);val write=AccessType.entries.first{it !in setOf(AccessType.READ,AccessType.READ_WRITE)}
        assertFalse(wiperCapability(CapabilityConfig(write),mapOf(FRONT_WIPER_AREA to WiperState.entries)).readable)
        assertEquals(WIPER_STATES,wiperCapability(read,mapOf(WindowArea(WindowValue.FRONT_WINDSHIELD) to WiperState.entries)).values)
        assertEquals(emptySet<String>(),wiperCapability(read,mapOf(WindowArea(WindowValue.FRONT_WINDSHIELD,WindowValue.REAR_WINDSHIELD) to WiperState.entries)).values)
        assertNull(wiperCapability(read,null).values);assertEquals(LIGHT_STATES,lightCapability(read,LightState.entries).values)
    }
    @Test fun `permission unsupported null advertised sets and one domain failure do not disable other reports`() {
        val f=Fixture();f.cap(ComponentFeature.WIPER_FRONT,ComponentCapability(true,emptySet()));assertFalse(f.sdk.getters.containsKey(ComponentFeature.WIPER_FRONT))
        f.sdk.capabilities.getValue(ComponentFeature.LOW_BEAM).second(SecurityException());f.worker.drain();assertEquals(ComponentStatus.PERMISSION_DENIED,f.row(ComponentFeature.LOW_BEAM).capabilityStatus)
        f.cap(ComponentFeature.HIGH_BEAM);f.event(ComponentFeature.HIGH_BEAM,ComponentValue.Mode("ON"));assertEquals(ComponentValue.Mode("ON"),f.row(ComponentFeature.HIGH_BEAM).value)
        val n=Fixture();n.cap(ComponentFeature.WIPER_FRONT,ComponentCapability(true,null));assertEquals(ComponentStatus.UNVERIFIED,n.row(ComponentFeature.WIPER_FRONT).capabilityStatus)
    }
    @Test fun `advertised enum null UNKNOWN and OTHER never become OFF or a healthy diagnosis`() {
        val f=Fixture();VISIBILITY_UI_V1.forEach{f.cap(it)}
        f.event(ComponentFeature.WIPER_FRONT,ComponentValue.Mode("OTHER"));assertEquals(ComponentStatus.UNVERIFIED,f.row(ComponentFeature.WIPER_FRONT).availabilityStatus);assertEquals(1000L,f.row(ComponentFeature.WIPER_FRONT).observedAt)
        f.event(ComponentFeature.WIPER_FRONT,null);assertNull(f.row(ComponentFeature.WIPER_FRONT).value);assertEquals(ComponentStatus.UNAVAILABLE,f.row(ComponentFeature.WIPER_FRONT).availabilityStatus)
        f.event(ComponentFeature.LOW_BEAM,ComponentValue.Mode("UNKNOWN"));assertNull(f.row(ComponentFeature.LOW_BEAM).value)
        f.event(ComponentFeature.HIGH_BEAM,ComponentValue.Mode("DAYTIME_RUNNING"));assertEquals(ComponentValue.Mode("DAYTIME_RUNNING"),f.row(ComponentFeature.HIGH_BEAM).value)
        val limited=Fixture();limited.cap(ComponentFeature.LOW_BEAM,ComponentCapability(true,setOf("OFF")));limited.event(ComponentFeature.LOW_BEAM,ComponentValue.Mode("ON"));assertEquals(ComponentStatus.UNVERIFIED,limited.row(ComponentFeature.LOW_BEAM).availabilityStatus)
    }
    @Test fun `each listener beats a late initial getter and preserves clock stale and permission failures`() {
        for(feature in VISIBILITY_UI_V1){val f=Fixture();f.cap(feature);f.sdk.events.getValue(feature).first(ComponentValue.Mode("ON"));f.at=2000;f.worker.drain()
            f.sdk.getters.getValue(feature).first(ComponentValue.Mode("OFF"));f.sdk.getters.getValue(feature).second(IllegalStateException());f.worker.drain()
            assertEquals(ComponentValue.Mode("ON"),f.row(feature).value);assertEquals(1000L,f.row(feature).observedAt)
            f.at=6001;assertEquals(ComponentStatus.STALE,f.row(feature).availabilityStatus)
            f.sdk.events.getValue(feature).second(SecurityException());f.worker.drain();assertEquals(ComponentStatus.SUPPORTED,f.row(feature).capabilityStatus);assertEquals(ComponentStatus.PERMISSION_DENIED,f.row(feature).availabilityStatus);assertNull(f.row(feature).value)
        }
    }
    @Test fun `visibility timeout and stop do not release unresolved SDK work or apply late reports`() {
        val f=Fixture();VISIBILITY_UI_V1.forEach{f.cap(it)};f.worker.timeout();assertEquals("UNRESOLVED",f.source.diagnostics.phase)
        f.channel.stop();f.worker.drain();VISIBILITY_UI_V1.forEach{f.sdk.getters.getValue(it).first(ComponentValue.Mode("ON"))};f.worker.drain()
        assertEquals(0,f.sdk.released);assertTrue(f.source.readSnapshot().readings.values.all{it.value==null});assertEquals(3,f.sdk.unregistered.size)
        f.channel.start();f.worker.drain();assertEquals(1,f.sdk.initialized)
    }
    @Test fun `three projections share one owner and visibility golden excludes all legacy rows`() {
        val f=Fixture();VISIBILITY_UI_V1.forEach{f.cap(it);f.event(it,ComponentValue.Mode(if(it==ComponentFeature.WIPER_FRONT)"OTHER" else "OFF"))}
        val json=f.channel.readVisibilityJson();val p=JsonParser.parseString(json).asJsonObject
        assertEquals(3,p["readings"].asJsonArray.size());assertEquals(4,JsonParser.parseString(f.channel.readJson()).asJsonObject["readings"].asJsonArray.size());assertEquals(1,JsonParser.parseString(f.channel.readChargePortJson()).asJsonObject["readings"].asJsonArray.size())
        repeat(50){f.channel.readVisibilityJson()};assertEquals(1,f.sdk.initialized);assertEquals(3,f.sdk.getters.size)
        val snapshot=ComponentSnapshot(f.source.readSnapshot().readings.mapValues{(_,r)->r.copy(source="MOCK")})
        val file=File("build/test-results/visibility-ui-v1.json");file.parentFile!!.mkdirs();file.writeText(ComponentUiProjection.visibilityJson(snapshot,"ATTACHED","ACTIVE","00000000-0000-4000-8000-000000000001",1))
        assertFalse(json.contains("reason"));assertFalse(json.contains("ev-charge"));assertFalse(json.contains("safety."))
    }
}
