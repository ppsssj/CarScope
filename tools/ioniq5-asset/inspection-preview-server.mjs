// Isolated desktop geometry review. No Android, AR, or existing inspection UI routes.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
if(!args.glb||!args.report) throw Error('usage: inspection-preview-server.mjs --glb=<source> --report=<P3-A6 report directory> [--port=8098]');
const here=dirname(fileURLToPath(import.meta.url)),report=resolve(args.report);
const files=new Map([
  ['/',[join(here,'inspection-preview.html'),'text/html']],
  ['/source.glb',[resolve(args.glb),'model/gltf-binary']],
  ['/report.json',[join(report,'inspection-components.json'),'application/json']],
  ...[0,60].map(d=>[`/inspection-${d}.glb`,[join(report,`inspection-${d}.glb`),'model/gltf-binary']]),
  ['/three',[resolve(here,'../three-poc/node_modules/three/build/three.module.js'),'text/javascript']],
  ['/loader',[resolve(here,'../three-poc/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),'text/javascript']],
  ['/utils',[resolve(here,'../three-poc/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'),'text/javascript']],
]);
// Explicit route table; source model is read-only and output remains caller-selected.
readFileSync(join(report,'inspection-components.json'));
createServer(async(req,res)=>{
  const entry=files.get(new URL(req.url,'http://localhost').pathname);
  if(!entry){res.writeHead(404);res.end();return;}
  try{const b=await readFile(entry[0]);res.writeHead(200,{'content-type':entry[1],'cache-control':'no-store'});res.end(b);}
  catch{res.writeHead(404);res.end();}
}).listen(Number(args.port??8098),'127.0.0.1',()=>console.log(`Geometry preview http://127.0.0.1:${args.port??8098}/`));
