// Debug-only service inspection; all positions cm -> glTF m by a proper rotation.
import * as THREE from 'three';
import { buildServiceComponents } from './ioniq5-asset/service-components.mjs';
export function attachServiceComponents({scene,shell,camera,canvas,dom,log,onSelect=()=>{}}){
  const services=buildServiceComponents(shell),$=(id)=>dom.getElementById(id),group=new THREE.Group(),reservations=new THREE.Group();
  group.name='__p3a23_services';reservations.name='__p3a23_service_reservations';group.visible=false;reservations.visible=false;scene.add(group,reservations);
  const toGltf=(T)=>{const p=new Float32Array(T.length);for(let i=0;i<T.length;i+=3){p[i]=T[i]/100;p[i+1]=T[i+2]/100;p[i+2]=-T[i+1]/100;}return p;};
  const meshes=[...services.parts,...services.reservations].map(p=>{
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(toGltf(p.triangles),3));geo.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({color:p.reservation?0xf59e0b:p.id==='washer-fluid-cap'?0x247dbc:0xc8d3d7,roughness:0.8,transparent:!!p.reservation,opacity:p.reservation?0.25:1,depthWrite:!p.reservation,wireframe:!!p.reservation});
    const mesh=new THREE.Mesh(geo,material);mesh.name=p.id;mesh.userData={synthetic:true,servicePart:true,meta:p.meta};(p.reservation?reservations:group).add(mesh);return mesh;
  });
  let selected=null;
  function select(id){
    const part=[...services.parts,...services.reservations].find(p=>p.id===id);
    selected=part?.id??null;for(const m of meshes)m.material.emissive.setHex(m.name===selected?0x804400:0);
    $('servicePart').value=selected??'';const info=$('serviceInfo');info.hidden=!part;
    if(!part)return null;
    onSelect(part.id);
    $('serviceName').textContent=part.label;
    $('serviceConfidence').textContent=`${part.id} · ${part.reservation?'예약 영역 / 실제 부품 형상 미구현':'점검 대상'}\n존재: CONFIRMED (2022 UK 설명서) · 위치/치수: ESTIMATED · 대상 시장/좌우 일치: UNVERIFIED`;
    $('serviceGuidance').textContent=part.reservation?'이 부품은 공식 배치도에서 존재를 확인했습니다. 실제 형상·배치가 확인될 때까지 예약 영역으로 표시합니다.':services.guidance;
    $('serviceSource').href=part.meta.source[0].split(' ')[0];$('serviceSource').textContent='Hyundai 2022 공식 설명서 · '+(part.reservation?'9-3 배치도':'9-14 워셔액');
    log('service-select',{id:selected,representation:part.meta.representation});return part.meta;
  }
  const ray=new THREE.Raycaster();
  function hitAt(x,y){
    const rect=canvas.getBoundingClientRect();scene.updateMatrixWorld(true);ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
    return ray.intersectObjects(scene.children,true).find(h=>{let n=h.object;while(n){if(!n.visible)return false;n=n.parent;}return h.object.isMesh;});
  }
  function pick(x,y){const hit=hitAt(x,y);if(!hit?.object.userData.servicePart)return false;select(hit.object.name);return true;}
  function setVisible(on){group.visible=on;$('services').checked=on;if(!on)select(null);}
  function setReservations(on){reservations.visible=on;$('serviceReservations').checked=on;}
  $('servicePart').innerHTML='<option value="">점검 부품 선택…</option>'+[...services.parts,...services.reservations].map(p=>`<option value="${p.id}">${p.label}</option>`).join('');
  $('services').onchange=e=>setVisible(e.target.checked);$('serviceReservations').onchange=e=>setReservations(e.target.checked);
  $('servicePart').onchange=e=>{const id=e.target.value,part=[...services.parts,...services.reservations].find(p=>p.id===id);if(part?.reservation)setReservations(true);else if(part)setVisible(true);select(id);};
  function screenPoint(id='washer-fluid-cap'){
    const mesh=meshes.find(m=>m.name===id);mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox,p=b.getCenter(new THREE.Vector3());p.y=b.max.y;p.applyMatrix4(mesh.matrixWorld).project(camera);
    const r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  }
  function compareWithNode(){scene.updateMatrixWorld(true);let max=0;
    for(const p of services.parts){const mesh=meshes.find(m=>m.name===p.id),pos=mesh.geometry.attributes.position;for(let i=0;i<pos.count;i++){const v=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld),car=[v.x*100,-v.z*100,v.y*100];for(let k=0;k<3;k++)max=Math.max(max,Math.abs(car[k]-p.triangles[3*i+k]));}}
    return{maxVertexDeltaCm:max,ids:services.parts.map(p=>p.id)};
  }
  log('services-built',{parts:services.parts.length,reservations:services.reservations.length});
  return{services,group,reservations,meshes,select,pick,setVisible,setReservations,screenPoint,compareWithNode,get selected(){return selected;}};
}
