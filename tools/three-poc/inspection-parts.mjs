// P10-1: the one list of inspectable parts. Names match the phone and Native screens, so one part reads the same everywhere.
// Pure data with no imports, shared by the flow, the result contract and the page. IDs are contract values: never rename one.
//
// geometrySource says what the 3D model really holds for this part:
//   GLB_ORIGINAL  the community reference model's own mesh
//   GLB_MARKER    the reference model's flat marker, not the real part
//   ESTIMATED     geometry authored for CarScope, never an OEM shape
//   NONE          no geometry: list and result only
// cameraClass groups parts for framing. P10-2 starts using it; today it describes and changes nothing:
//   PART, MARKER (thin or flat, framed by width), UNDERBODY (seen from below), NONE (no geometry to frame)
const part=(id,taskId,area,label,geometrySource,cameraClass,status,location)=>Object.freeze({id,taskId,area,label,geometrySource,cameraClass,status,...(location?{location}:{})});

export const INSPECTION_PARTS=Object.freeze([
  part('washer-fluid-cap','washer-fluid','hood','워셔액','ESTIMATED','PART','available'),
  part('coolant-reservoir','coolant-reservoir','hood','냉각수 리저버','ESTIMATED','PART','preview','모델 전방 구획의 차량 우측 중간'),
  part('lcw-coolant-reservoir','lcw-coolant-reservoir','hood','저전도 냉각수 리저버','NONE','NONE','planned'),
  part('brake-fluid-reservoir','brake-fluid','hood','브레이크액','ESTIMATED','PART','preview','모델 전방 구획의 차량 좌측 뒤쪽'),
  part('battery-12v','battery-12v','hood','12V 보조 배터리','ESTIMATED','PART','preview','모델 전방 구획의 차량 좌측 앞쪽'),
  part('fuse-box','fuse-box','hood','모터룸 퓨즈박스','ESTIMATED','PART','preview','모델 전방 구획의 차량 좌측 중간'),
  part('tire.front-left','tire.front-left','tires','앞 왼쪽 타이어','GLB_ORIGINAL','PART','preview'),
  part('tire.front-right','tire.front-right','tires','앞 오른쪽 타이어','GLB_ORIGINAL','PART','preview'),
  part('tire.rear-left','tire.rear-left','tires','뒤 왼쪽 타이어','GLB_ORIGINAL','PART','preview'),
  part('tire.rear-right','tire.rear-right','tires','뒤 오른쪽 타이어','GLB_ORIGINAL','PART','preview'),
  part('ev-battery.pack',null,'ev-battery','고전압 배터리 팩','ESTIMATED','UNDERBODY','preview'),
  part('ev-charge.port','ev-charge.port','ev-charge','EV 충전구','ESTIMATED','PART','preview'),
  part('ev-charge.flap',null,'ev-charge','EV 충전구 덮개','ESTIMATED','PART','preview'),
  part('wiper.front.left','wiper.front.left','wipers','전면 왼쪽 와이퍼','ESTIMATED','MARKER','preview'),
  part('wiper.front.right','wiper.front.right','wipers','전면 오른쪽 와이퍼','ESTIMATED','MARKER','preview'),
  part('light-low-beam-left-0','light-low-beam-left-0','lights','왼쪽 하향등','GLB_MARKER','MARKER','preview'),
  part('light-low-beam-right-0','light-low-beam-right-0','lights','오른쪽 하향등','GLB_MARKER','MARKER','preview'),
  part('light-high-beam-left-0','light-high-beam-left-0','lights','왼쪽 상향등','GLB_MARKER','MARKER','preview'),
  part('light-high-beam-right-0','light-high-beam-right-0','lights','오른쪽 상향등','GLB_MARKER','MARKER','preview'),
]);

export const partById=id=>INSPECTION_PARTS.find(p=>p.id===id);
export const partLabel=id=>partById(id)?.label;
export const partsInArea=area=>INSPECTION_PARTS.filter(p=>p.area===area);
/** The list row for one part. The flow and the panel read only these fields. */
export const partListItem=p=>Object.freeze({id:p.id,label:p.label,status:p.status,...(p.location?{location:p.location}:{})});
