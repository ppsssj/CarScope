// Reusable camera/2D overlay session. No detector, world anchor, media storage or upload.
import {CameraSession,cameraError} from './camera.mjs';
import {containRect} from './detector.mjs';
import {tapToVideoPoint,videoPointToStage,drawMarker} from './marker.mjs';
export class InspectionCamera {
  constructor({video,overlay,stage,start,stop,clear,placeholder,canRun,onStatus,onAids,targetLabel='부품',drawGuide=()=>{}}){
    Object.assign(this,{video,overlay,stage,startButton:start,stopButton:stop,clearButton:clear,placeholder,canRun,onStatus,onAids,targetLabel,drawGuide});
    this.ctx=overlay.getContext('2d');this.request=0;this.timer=null;this.pending=false;this.mark=null;this.shape=null;
    this.session=new CameraSession(video,navigator.mediaDevices,()=>this.stop('카메라 연결이 종료됐습니다. 카메라 없이 점검할 수 있습니다.'));
    start.onclick=()=>void this.start();stop.onclick=()=>this.stop('카메라를 중지했습니다.');clear.onclick=()=>this.clearMark();
    let down=null;stage.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});stage.addEventListener('pointerup',e=>{
      const tap=down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<12;down=null;if(!tap||!this.timer||!canRun())return;
      const b=stage.getBoundingClientRect(),p=tapToVideoPoint(e.clientX-b.left,e.clientY-b.top,video.videoWidth,video.videoHeight,b.width,b.height);
      if(!p)return;this.mark=p;clear.disabled=false;stage.dataset.marked='true';this.onAids({locationMarked:true});this.draw();this.onStatus('내가 지정한 2D 위치입니다. 휴대폰을 움직이면 다시 지정하세요.');
    });
    this.reset=()=>this.clearMark();new ResizeObserver(this.reset).observe(stage);addEventListener('orientationchange',this.reset);screen.orientation?.addEventListener('change',this.reset);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop('화면이 숨겨져 카메라를 중지했습니다.');});addEventListener('pagehide',()=>this.stop());
    for(const name of ['stalled','error','ended'])video.addEventListener(name,()=>this.stop('영상이 정지했습니다. 카메라 없이 점검할 수 있습니다.'));
    video.addEventListener('pause',()=>{if(this.timer)this.stop('영상이 멈춰 위치 표시를 해제했습니다.');});this.stop();
  }
  clearMark(){this.mark=null;this.clearButton.disabled=true;this.stage.removeAttribute('data-marked');this.ctx.clearRect(0,0,this.overlay.width,this.overlay.height);if(this.timer)this.draw();}
  stop(message='카메라가 꺼져 있습니다.'){
    this.request++;clearInterval(this.timer);this.timer=null;this.pending=false;this.session.stop();this.clearMark();this.shape=null;this.placeholder.hidden=false;this.startButton.disabled=!this.canRun();this.stopButton.disabled=true;this.onStatus(message);
  }
  async start(){if(this.pending||this.timer||!this.canRun())return;
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){this.stop('카메라를 쓸 수 없는 환경입니다. 신뢰하는 HTTPS에서 열거나 카메라 없이 점검하세요.');return;}
    const generation=++this.request;this.pending=true;this.clearMark();this.startButton.disabled=true;this.stopButton.disabled=false;this.onStatus('카메라 권한을 요청합니다.');
    try{if(!await this.session.start()||generation!==this.request||!this.canRun())return;this.pending=false;this.placeholder.hidden=true;this.lastTime=-1;this.lastFrameAt=performance.now();this.onAids({cameraUsed:true});this.timer=setInterval(()=>this.scan(),250);this.scan();}
    catch(e){if(generation===this.request)this.stop(`${cameraError(e)} 카메라 없이 점검할 수 있습니다.`);}
  }
  scan(){const v=this.video;if(!this.canRun()){this.stop();return;}
    if(v.readyState<2||!v.videoWidth||!v.videoHeight){this.clearMark();if(performance.now()-this.lastFrameAt>2000)this.stop('영상이 준비되지 않아 표시를 해제했습니다.');return;}
    const shape=`${v.videoWidth}:${v.videoHeight}`;if(this.shape&&this.shape!==shape)this.clearMark();this.shape=shape;
    if(v.currentTime!==this.lastTime){this.lastTime=v.currentTime;this.lastFrameAt=performance.now();}else if(performance.now()-this.lastFrameAt>2000){this.stop('영상 갱신이 멈춰 위치 표시를 해제했습니다.');return;}
    this.draw();if(!this.mark)this.onStatus(`${this.targetLabel}을 비추고 화면을 탭해 위치를 직접 지정하세요. 자동 인식·정밀 측정은 하지 않습니다.`);
  }
  draw(){const v=this.video,c=this.overlay,b=this.stage.getBoundingClientRect(),d=devicePixelRatio;c.width=Math.max(1,Math.round(b.width*d));c.height=Math.max(1,Math.round(b.height*d));const ctx=this.ctx;ctx.clearRect(0,0,c.width,c.height);if(!this.timer||!v.videoWidth||!v.videoHeight)return;
    const r=containRect(v.videoWidth,v.videoHeight,c.width,c.height);ctx.save();this.drawGuide(ctx,r,d);ctx.restore();
    if(this.mark)drawMarker(ctx,videoPointToStage(this.mark,v.videoWidth,v.videoHeight,c.width,c.height),d);
  }
}
