// Internal visual IDs; front-wiper state and each beam are shared reports, never per-side sensors.
import {partLabel} from './inspection-parts.mjs';
export const WIPER_PARTS=Object.freeze(['wiper.front.left','wiper.front.right']);
export const LIGHT_PARTS=Object.freeze([
  {id:'light-low-beam-left-0',node:'Light_Low_Beam_Left_0',feature:'light.low-beam',side:1},
  {id:'light-low-beam-right-0',node:'Light_Low_Beam_Right_0',feature:'light.low-beam',side:-1},
  {id:'light-high-beam-left-0',node:'Light_High_Beam_Left_0',feature:'light.high-beam',side:1},
  {id:'light-high-beam-right-0',node:'Light_High_Beam_Right_0',feature:'light.high-beam',side:-1},
].map(p=>Object.freeze({...p,label:partLabel(p.id)})));
