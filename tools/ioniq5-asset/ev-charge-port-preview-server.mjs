// Explicit local read-only routes for the geometry review, no SDK/product UI routes.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const a=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
if(!a.glb||!a.report)throw Error('usage: ev-charge-port-preview-server.mjs --glb=<source> --report=<external report dir> [--port=8104]');
const here=dirname(fileURLToPath(import.meta.url));
const routes=new Map([
  ['/',[join(here,'ev-charge-port-preview.html'),'text/html; charset=utf-8']],
  ['/source.glb',[resolve(a.glb),'model/gltf-binary']],['/charge.glb',[resolve(a.report,'ev-charge-port.glb'),'model/gltf-binary']],
  ['/report.json',[resolve(a.report,'ev-charge-port.json'),'application/json']],
  ['/charge.svg',[resolve(a.report,'ev-charge-port.svg'),'image/svg+xml']],
  ['/three',[resolve(here,'../three-poc/node_modules/three/build/three.module.js'),'text/javascript']],
  ['/loader',[resolve(here,'../three-poc/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),'text/javascript']],
  ['/utils',[resolve(here,'../three-poc/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'),'text/javascript']],
]);
createServer(async(q,r)=>{const entry=routes.get(new URL(q.url,'http://localhost').pathname);
  if(!entry){r.writeHead(q.url==='/favicon.ico'?204:404);r.end();return;}
  try{const b=await readFile(entry[0]);r.writeHead(200,{'content-type':entry[1],'cache-control':'no-store'});r.end(b);}catch{r.writeHead(404);r.end();}
}).listen(Number(a.port??8104),'127.0.0.1',()=>console.log(`Charge-port geometry http://127.0.0.1:${a.port??8104}/`));
