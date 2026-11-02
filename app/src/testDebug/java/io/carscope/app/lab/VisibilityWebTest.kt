package io.carscope.app.lab

import android.app.Activity
import android.net.Uri
import android.webkit.WebResourceRequest
import com.google.gson.JsonParser
import io.carscope.app.component.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34])
class VisibilityWebTest {
    private val host="carscope-inspection.invalid"
    private fun request(url:String,method:String="GET")=object:WebResourceRequest{
        override fun getUrl()=Uri.parse(url);override fun getMethod()=method
        override fun isForMainFrame()=false;override fun isRedirect()=false;override fun hasGesture()=false;override fun getRequestHeaders()=emptyMap<String,String>()
    }
    @Test fun `visibility endpoint is exact private cache GET and does not open other channels`() {
        val worker=ComponentTestWorker();val sdk=ComponentFakeSession();val source=PleosComponentDataSource({sdk},worker,{1000});val channel=ComponentUiChannel(ComponentOwner(source));channel.start();worker.drain()
        VISIBILITY_UI_V1.forEach{f->sdk.capabilities.getValue(f).first(ComponentCapability(true,testComponentValues(f)))};worker.drain()
        VISIBILITY_UI_V1.forEach{f->sdk.getters.getValue(f).first(ComponentValue.Mode("OFF"))};worker.drain()
        val activity=Robolectric.buildActivity(Activity::class.java).setup();var reads=0
        val screen=DebugWebScreen(activity.get(),"VisibilityTest",host,"inspection",emptyMap(),visibilityStatusJson={reads++;channel.readVisibilityJson()});val web=screen.create("")
        try{val client=shadowOf(web).webViewClient!!;val response=client.shouldInterceptRequest(web,request("https://$host/visibility-status.json"))!!
            assertEquals(200,response.statusCode);assertEquals("no-store",response.responseHeaders!!["Cache-Control"])
            val p=JsonParser.parseString(response.data!!.bufferedReader().readText()).asJsonObject;assertEquals(3,p["readings"].asJsonArray.size());assertTrue(p["readings"].asJsonArray.all{it.asJsonObject["value"].asString=="OFF"})
            for(path in listOf("visibility-status.json?x=1","visibility-status.json#x","%76isibility-status.json","component-status.json","ev-charge-status.json","tire-status.json"))assertEquals(404,client.shouldInterceptRequest(web,request("https://$host/$path"))!!.statusCode)
            assertEquals(404,client.shouldInterceptRequest(web,request("https://$host/visibility-status.json","POST"))!!.statusCode)
            assertEquals(404,client.shouldInterceptRequest(web,request("https://evil.invalid/visibility-status.json"))!!.statusCode)
            assertEquals(1,reads);assertEquals(3,sdk.getters.size);assertFalse(web.settings.allowFileAccess);assertFalse(web.settings.allowContentAccess)
        }finally{screen.destroy();channel.stop();source.close();worker.drain();activity.pause().stop().destroy()}
    }
    @Test fun `Activity visibility channel invalidates stop rotates resume and survives recreation without extra client`() {
        val field=ComponentProcessOwner::class.java.getDeclaredField("owner").apply{isAccessible=true};val old=field.get(null)
        val worker=ComponentTestWorker();val sdk=ComponentFakeSession();val source=PleosComponentDataSource({sdk},worker,{1000});field.set(null,ComponentOwner(source))
        fun packet(a:InspectionActivity)=JsonParser.parseString((InspectionActivity::class.java.getDeclaredField("componentStatus").apply{isAccessible=true}.get(a) as ComponentUiChannel).readVisibilityJson()).asJsonObject
        val activity=Robolectric.buildActivity(InspectionActivity::class.java)
        try{activity.create().start().resume();worker.drain();val before=packet(activity.get());activity.pause().stop();worker.drain();assertEquals("STOPPED",packet(activity.get())["connectionStatus"].asString)
            activity.restart().start().resume();worker.drain();val resumed=packet(activity.get());assertNotEquals(before["sessionId"],resumed["sessionId"]);activity.pause().stop().destroy();worker.drain()
            val recreated=Robolectric.buildActivity(InspectionActivity::class.java).create().start().resume()
            try{worker.drain();assertNotEquals(resumed["sessionId"],packet(recreated.get())["sessionId"]);assertEquals(1,sdk.initialized)}finally{recreated.pause().stop().destroy();worker.drain()}
        }finally{field.set(null,old);source.close();worker.drain()}
    }
}
