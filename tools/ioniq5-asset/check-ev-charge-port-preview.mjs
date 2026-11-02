import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,isAbsolute,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(process.argv[2]??''),rel=relative(repo,out);
if(!process.argv[2]||!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Provide output outside repo');mkdirSync(out,{recursive:true});
const ev=s=>['eval',s],shot=n=>[['wait',250],['shot',join(out,n+'.png'),'body']];
const actions=[['until','window.__charge?.ready',60000],
  ev("(()=>{const g=window.__charge;if(!g.renderer.capabilities.isWebGL2||g.rows.length!==2||g.report.failures)throw Error('loaded geometry');return JSON.stringify({rows:g.rows,webgl2:true});})()"),...shot('01-vehicle'),
  ['click','[data-view="focus"]'],...shot('02-focus'),['click','#view canvas',.5,.5],
  ev("(()=>{const g=window.__charge;if(g.selected!=='ev-charge.flap'||g.pick(0,0)!=='ev-charge.flap'||!g.parts.get(g.selected).material.emissive.getHex())throw Error('flap raycast/highlight');return 'PASS flap raycast and highlight';})()"),...shot('03-selected-flap'),
  ['click','#clear'],ev("(()=>{const g=window.__charge;if(g.selected!==null||[...g.parts.values()].some(m=>m.material.emissive.getHex()))throw Error('deselect');return 'PASS deselect';})()"),
  ['click','[data-view="frame"]'],['click','#view canvas',.5,.5],
  ev("(()=>{const g=window.__charge;if(g.selected!=='ev-charge.port'||g.pick(0,0)!=='ev-charge.port'||JSON.parse(document.querySelector('#info').textContent).hingeConfidence!=='UNVERIFIED')throw Error('frame raycast/metadata');return 'PASS frame raycast and metadata';})()"),...shot('04-selected-frame'),
  ['click','[data-view="isolated"]'],['click','#flap'],...shot('05-surround-review'),['click','#flap'],...shot('06-isolated-closed'),
  ['click','#clear'],['click','[data-view="vehicle"]'],
  ev("(()=>{const g=window.__charge;if(g.originals.some(t=>t.object.matrix.toArray().some((v,k)=>v!==t.matrix[k])))throw Error('source transform');if(g.camera.position.toArray().some((v,k)=>Math.abs(v-g.vehiclePose.position[k])>1e-12)||g.camera.quaternion.toArray().some((v,k)=>Math.abs(v-g.vehiclePose.quaternion[k])>1e-12))throw Error('camera restore');return 'PASS camera restore and source transform';})()"),...shot('07-restored'),
];
writeFileSync(join(out,'actions.json'),JSON.stringify(actions));
const home=process.env.ANATOMY_HOME??join(homedir(),'.claude/skills/anatomy'),r=spawnSync(process.execPath,['--experimental-websocket',join(home,'scripts/drive.mjs'),process.argv[3]??'http://127.0.0.1:8104/','--actions',join(out,'actions.json'),'--width','1440','--height','1000'],{encoding:'utf8',maxBuffer:64<<20});
writeFileSync(join(out,'browser-log.txt'),(r.stdout??'')+'\n'+(r.stderr??''));const passed=r.status===0&&(r.stdout??'').includes('console: clean')&&(r.stdout??'').includes('PASS camera restore');
writeFileSync(join(out,'browser-results.json'),JSON.stringify({passed,exitCode:r.status}));console.log(r.stdout??'');if(r.stderr)console.error(r.stderr);process.exitCode=passed?0:1;
