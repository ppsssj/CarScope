// Local geometry review only; no inspection UI, SDK or Android routes.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
if(!args.glb||!args.report)throw Error('usage: front-wiper-preview-server.mjs --glb=<source> --report=<external report dir> [--port=8106]');
const here=dirname(fileURLToPath(import.meta.url));
const files=new Map([
  ['/',[join(here,'front-wiper-preview.html'),'text/html; charset=utf-8']],
  ['/source.glb',[resolve(args.glb),'model/gltf-binary']],
  ['/pack.glb',[resolve(args.report,'front-wiper.glb'),'model/gltf-binary']],
  ['/review.svg',[resolve(args.report,'front-wiper.svg'),'image/svg+xml']],
  ['/report.json',[resolve(args.report,'front-wiper.json'),'application/json']],
  ['/three',[resolve(here,'../three-poc/node_modules/three/build/three.module.js'),'text/javascript']],
  ['/loader',[resolve(here,'../three-poc/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),'text/javascript']],
  ['/utils',[resolve(here,'../three-poc/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'),'text/javascript']],
  ['/favicon.ico',[null,'image/x-icon']],
]);
createServer(async(req,res)=>{
  const entry=files.get(new URL(req.url,'http://localhost').pathname);
  if(!entry){res.writeHead(404);res.end();return;}
  if(!entry[0]){res.writeHead(204);res.end();return;}
  try{const bytes=await readFile(entry[0]);res.writeHead(200,{'content-type':entry[1],'cache-control':'no-store'});res.end(bytes);}
  catch{res.writeHead(404);res.end();}
}).listen(Number(args.port??8106),'127.0.0.1',()=>console.log(`Front wiper geometry review http://127.0.0.1:${args.port??8106}/`));

