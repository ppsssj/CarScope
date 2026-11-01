// Uses the repository's existing pinned Anatomy driver, with a dedicated URL/output directory.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,isAbsolute,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(process.argv[2]??''),rel=relative(repo,out);
if(!process.argv[2]||!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Provide an output folder outside the repo');
mkdirSync(out,{recursive:true});
const ev=s=>['eval',s],shot=n=>[['wait',300],['shot',join(out,n+'.png'),'body']];
const actions=[['until','window.__geometry?.ready',60000],
  ev("(() => {const g=window.__geometry;if(g.rows.length!==12||g.report.failures!==0)throw Error('geometry report');return JSON.stringify({rows:g.rows,webgl:g.renderer.capabilities.isWebGL2});})()"),...shot('01-bay'),
  ev("window.__geometry.setView('top'); 'top'"),...shot('02-top'),
  ev("window.__geometry.setView('side'); 'side'"),...shot('03-side'),
  ['click','#cover'],ev("window.__geometry.setView('bay'); 'cover60'"),...shot('04-cover-open'),
  ...['coolant-reservoir','brake-fluid-reservoir','battery-12v','fuse-box'].flatMap(id=>[ev(`(() => {window.__geometry.select('${id}');const p=JSON.parse(document.getElementById('info').textContent);if(p.id!=='${id}'||p.dimensionConfidence!=='ESTIMATED'||p.variantPlacementConfidence!=='UNVERIFIED')throw Error('selection metadata');return p.id+' ESTIMATED / UNVERIFIED';})()`),...shot(id)]),
  ['click','#cover'],ev("window.__geometry.select('');window.__geometry.setView('closed'); 'closed'"),...shot('09-closed'),
];
writeFileSync(join(out,'actions.json'),JSON.stringify(actions));
const anatomy=process.env.ANATOMY_HOME??join(homedir(),'.claude/skills/anatomy');
const r=spawnSync(process.execPath,['--experimental-websocket',join(anatomy,'scripts/drive.mjs'),process.argv[3]??'http://127.0.0.1:8098/','--actions',join(out,'actions.json'),'--width','1440','--height','1000'],{encoding:'utf8',maxBuffer:64<<20});
writeFileSync(join(out,'browser-log.txt'),(r.stdout??'')+'\n'+(r.stderr??''));
const passed=r.status===0&&(r.stdout??'').includes('console: clean')&&(r.stdout??'').includes('washer-fluid-cap');
writeFileSync(join(out,'browser-results.json'),JSON.stringify({passed,exitCode:r.status}));
console.log(r.stdout??'');if(r.stderr)console.error(r.stderr);process.exitCode=passed?0:1;
