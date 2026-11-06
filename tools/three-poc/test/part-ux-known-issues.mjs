// P10-0: the 3D part UX defects known at this baseline. One entry per defect, each with the measurable condition that
// means "fixed". A later PR that fixes one sets status to FIXED in the same change, and from then on it may not come back.
// `measure` names how the claim is checked:
//   BROWSER   the real-GLB page check decides it (tools/three-poc/test/browser-part-ux-baseline.mjs, local only)
//   NODE      a pure test in CI decides it (test/part-ux-known-issues.test.mjs)
//   VISUAL    a person judges the capture; never counted as PASS by a script
//   NEEDS_P10 the page exposes no value to measure yet; the code reading is the only evidence
export const PART_UX_ISSUES=Object.freeze([
  {id:'P0-1',severity:'P0',title:'Washer result screen falls back to the whole-vehicle view',measure:'BROWSER',fixIn:'P10-2',code:'inspect.js:217'},
  {id:'P0-2',severity:'P0',title:'Tire switching moves the camera through the vehicle body',measure:'BROWSER',fixIn:'P10-2',code:'inspect.js:700'},
  {id:'P0-3',severity:'P0',title:'Back from a part result ignores where the user came from',measure:'NODE',fixIn:'P10-3',code:'inspection-flow.mjs:126'},
  {id:'P0-4',severity:'P0',title:'Overview says parts are highlighted, but only the hood is',measure:'BROWSER',fixIn:'P10-4',code:'inspect.js:668'},
  {id:'P1-1',severity:'P1',title:'Selected parts take very different shares of the screen',measure:'BROWSER',fixIn:'P10-2'},
  {id:'P1-2',severity:'P1',title:'Hood parts stop at the minimum distance and lose their surroundings',measure:'VISUAL',fixIn:'P10-2'},
  {id:'P1-3',severity:'P1',title:'Only the washer has a 3D label',measure:'BROWSER',fixIn:'P10-5'},
  {id:'P1-4',severity:'P1',title:'The same selection strength looks different on each material',measure:'BROWSER',fixIn:'P10-4'},
  {id:'P1-5',severity:'P1',title:'Selection covers the result color on every part but tires',measure:'NEEDS_P10',fixIn:'P10-4',code:'inspect.js:679'},
  {id:'P1-6',severity:'P1',title:'Not-inspected tires are tinted while other parts keep their material',measure:'BROWSER',fixIn:'P10-4'},
  {id:'P1-7',severity:'P1',title:'The state legend counts 4 tires while 17 parts have results',measure:'NODE',fixIn:'P10-4'},
  {id:'P1-8',severity:'P1',title:'A part of another area cannot be selected from a detail screen',measure:'BROWSER',fixIn:'P10-3'},
  {id:'P1-9',severity:'P1',title:'The tire list shows a different view depending on how it was reached',measure:'BROWSER',fixIn:'P10-2'},
  {id:'P1-10',severity:'P1',title:'EV battery is tagged as inspectable without an inspection task',measure:'BROWSER',fixIn:'P10-6'},
  {id:'P1-11',severity:'P1',title:'The part without geometry has the strongest list border',measure:'BROWSER',fixIn:'P10-6'},
  {id:'P1-12',severity:'P1',title:'A preview says no procedure exists next to the button that starts one',measure:'BROWSER',fixIn:'P10-6'},
  {id:'P1-13',severity:'P1',title:'Thin parts offer a small target for a finger',measure:'BROWSER',fixIn:'P10-5'},
  {id:'P2-1',severity:'P2',title:'Charge port and wipers appear and disappear between screens',measure:'BROWSER',fixIn:'P10-7'},
  {id:'P2-2',severity:'P2',title:'Back buttons use several different labels',measure:'BROWSER',fixIn:'P10-3'},
  {id:'P2-3',severity:'P2',title:'Internal values reach the user',measure:'BROWSER',fixIn:'P10-6'},
  {id:'P2-4',severity:'P2',title:'High beams use a different elevation on the result screen',measure:'BROWSER',fixIn:'P10-2'},
  {id:'P2-5',severity:'P2',title:'The toast centers on the window, not on the free space',measure:'BROWSER',fixIn:'P10-6'},
  {id:'P2-6',severity:'P2',title:'The 3D label does not check whether it is covered',measure:'NEEDS_P10',fixIn:'P10-5',code:'inspect.js:682'},
  {id:'P2-7',severity:'P2',title:'A programmatic focus draws a box around the title',measure:'BROWSER',fixIn:'P10-6'},
  {id:'P2-8',severity:'P2',title:'The underbody view is hard to read',measure:'VISUAL',fixIn:'P10-7'},
  {id:'P2-9',severity:'P2',title:'The 12V battery cites two manual pages',measure:'NODE',fixIn:'P10-7'},
].map(x=>Object.freeze({status:'OPEN',...x})));

export const issueById=id=>PART_UX_ISSUES.find(x=>x.id===id);
