// node tools/three-poc/check-ioniq5-frunk.mjs <external output dir> [url]
// Uses the existing pinned Anatomy browser driver; never puts model captures in the repo.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.argv[2] ?? ''), rel = relative(repo, out);
if (!process.argv[2] || !rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('Provide an output folder outside the repo');
mkdirSync(out, { recursive: true });
const ev = (s) => ['eval', s], shot = (name) => [['wait', 300], ['shot', join(out, name + '.png'), 'body']];
const actions = [
  ['until', "window.__labLog?.some(e => e.tag === 'loaded' || e.tag === 'load-error')", 60000],
  ev(`(() => { const h=window.__hood, f=window.__frunk, loaded=window.__labLog.find(e=>e.tag==='loaded');
    if (!loaded || !f || loaded.zeroDegree.hoodWorldMatrixMaxDelta!==0) throw Error('load/identity');
    const fail=(s)=>{throw Error(s)};
    document.getElementById('frunk').click();
    if (!f.group.visible || !h.state.fc.group.visible) fail('show controls');
    if (f.setAngle(60).accepted || f.angle!==0) fail('closed hood guard');
    h.setAngle(45); f.setAngle(60); h.setAngle(0);
    if (h.state.angle!==45 || f.angle!==60) fail('lowering guard');
    h.useAxis('B'); if(h.state.axis.id==='B') fail('axis guard');
    f.setAngle(0); h.useAxis('B'); if(f.setAngle(60).accepted) fail('unvalidated axis guard');
    h.useAxis('A'); f.select('frunk-cover'); if(!document.getElementById('frunkInfo').textContent.includes('UNVERIFIED')) fail('metadata');
    const rows=[];
    for(const id of ['A','C']) { h.useAxis(id); for(const hd of [45,60]) { h.setAngle(hd); for(const cd of [0,15,30,45,60]) {
      const v=f.compareWithNode(cd), c=f.check();
      if(v.maxVertexDeltaCm>0.00003 || c.rows.some(r=>r.fixedCrossings||r.hoodCrossings)) fail('pose '+JSON.stringify({v,c})); rows.push({hd,id,v,c});
    } } }
    f.setAngle(0); h.useAxis('A'); h.setAngle(0); return JSON.stringify({loaded,rows}); })()`),
  ...shot('01-closed'),
  ev("window.__hood.setAngle(45); window.__hood.useView('bay'); window.__frunk.select(null); 'cover closed'"), ...shot('02-hood45-cover0'),
  ['click', '#view canvas', 0.62, 0.51], ['wait', 1100],
  ev("(() => {if(window.__frunk.angle!==60) throw Error('canvas cover click did not open'); window.__frunk.setAngle(0); return 'canvas click open PASS';})()"),
  ev("window.__frunk.setAngle(30); 'half open'"), ...shot('03-cover30'),
  ev("window.__frunk.animateTo(60,500).then(r=>JSON.stringify(r))"), ...shot('04-cover60'),
  ev("window.__hood.useView('baytop'); 'top'"), ...shot('05-open-top'),
  ev("window.__hood.useView('bayside'); 'side'"), ...shot('06-open-side'),
  ev("window.__hood.useAxis('C'); window.__hood.setAngle(60); window.__hood.useView('bayiso'); window.__frunk.select('frunk-tub'); 'C60'"), ...shot('07-axisC60-tub'),
  ev("window.__frunk.animateTo(0,500).then(()=>{window.__hood.setAngle(0);return JSON.stringify({cover:window.__frunk.angle,hood:window.__hood.state.angle})})"), ...shot('08-restored'),
  ev("window.__hood.svgTiming(['closed-frunk.svg','hood45-cover0.svg','hood45-cover60.svg'],'./external/p3-a2-2/svg/').then(r=>JSON.stringify(r))"),
];
writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
const r = spawnSync(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), process.argv[3] ?? 'http://127.0.0.1:8096/ioniq5-hood.html', '--actions', join(out, 'actions.json'), '--width','1440','--height','1000'], { encoding:'utf8', maxBuffer:64<<20 });
writeFileSync(join(out, 'browser-log.txt'), (r.stdout??'')+'\n'+(r.stderr??''));
const evals=(r.stdout??'').split('\n').filter(s=>s.startsWith('eval: ')).map(s=>{try {const x=JSON.parse(s.slice(6));try{return JSON.parse(x)}catch{return x}}catch{return s}});
const passed = r.status===0 && evals.some((e)=>e?.rows?.length===20) && (r.stdout??'').includes('console: clean');
writeFileSync(join(out, 'browser-results.json'), JSON.stringify({exitCode:r.status,passed,evals},null,2));
console.log((r.stdout??'').split('\n').map(s=>s.slice(0,300)).join('\n')); if(r.stderr) console.error(r.stderr);
process.exitCode=passed?0:1;
