// Dedicated browser review; reuses the pinned Anatomy Chrome driver.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,isAbsolute,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(process.argv[2]??''),rel=relative(repo,out);
if(!process.argv[2]||!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Provide output outside the repo');
mkdirSync(out,{recursive:true});
const ev=s=>['eval',s],shot=n=>[['wait',300],['shot',join(out,n+'.png'),'body']];
const actions=[['until','window.__battery?.ready',60000],
  ev("(()=>{const g=window.__battery;if(!g.renderer.capabilities.isWebGL2||g.boundsDeltaCm>0.0001||g.report.failures!==0)throw Error('render/bounds/report');return 'PASS loaded WebGL2, bounds, collision report';})()"),...shot('01-vehicle'),
  ...['underbody','context','isolated'].flatMap(v=>[ev(`window.__battery.setView('${v}'); '${v}'`),...shot(v)]),
  ['click','#view canvas',0.5,0.5],
  ev("(()=>{const g=window.__battery;if(g.pick(0,0)!=='ev-battery.pack')throw Error('raycast ID');if(!g.selected||g.mesh.material.emissive.getHex()===0||JSON.parse(document.querySelector('#info').textContent).geometryConfidence!=='ESTIMATED_GEOMETRY')throw Error('selection/metadata');return 'PASS raycast, highlight, estimated metadata';})()"),...shot('05-selected'),
  ['click','#select'],ev("(()=>{const g=window.__battery;if(g.selected||g.mesh.material.emissive.getHex()!==0)throw Error('deselect');g.setView('vehicle');if(g.originalTransforms.some(t=>t.object.matrix.toArray().some((v,k)=>v!==t.matrix[k])))throw Error('source transform changed');return 'PASS deselection and unchanged source transforms';})()"),...shot('06-restored'),
];
writeFileSync(join(out,'actions.json'),JSON.stringify(actions));
const anatomy=process.env.ANATOMY_HOME??join(homedir(),'.claude/skills/anatomy');
const r=spawnSync(process.execPath,['--experimental-websocket',join(anatomy,'scripts/drive.mjs'),process.argv[3]??'http://127.0.0.1:8102/','--actions',join(out,'actions.json'),'--width','1440','--height','1000'],{encoding:'utf8',maxBuffer:64<<20});
writeFileSync(join(out,'browser-log.txt'),(r.stdout??'')+'\n'+(r.stderr??''));
const passed=r.status===0&&(r.stdout??'').includes('console: clean')&&(r.stdout??'').includes('PASS deselection');
writeFileSync(join(out,'browser-results.json'),JSON.stringify({passed,exitCode:r.status}));
console.log(r.stdout??'');if(r.stderr)console.error(r.stderr);process.exitCode=passed?0:1;
