// Internal visual IDs; front-wiper state and each beam are shared reports, never per-side sensors.
export const WIPER_PARTS=Object.freeze(['wiper.front.left','wiper.front.right']);
export const LIGHT_PARTS=Object.freeze([
  {id:'light-low-beam-left-0',node:'Light_Low_Beam_Left_0',feature:'light.low-beam',side:1,label:'차량 좌측 하향등 표식'},
  {id:'light-low-beam-right-0',node:'Light_Low_Beam_Right_0',feature:'light.low-beam',side:-1,label:'차량 우측 하향등 표식'},
  {id:'light-high-beam-left-0',node:'Light_High_Beam_Left_0',feature:'light.high-beam',side:1,label:'차량 좌측 상향등 표식'},
  {id:'light-high-beam-right-0',node:'Light_High_Beam_Right_0',feature:'light.high-beam',side:-1,label:'차량 우측 상향등 표식'},
]);
