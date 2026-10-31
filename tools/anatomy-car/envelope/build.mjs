import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateEnvelope, verifyEnvelope } from "./artifacts.mjs";
try {
  const args=process.argv.slice(2);
  let mode=null,out=join(dirname(fileURLToPath(import.meta.url)),"..","build","envelope");
  while(args.length) {
    const a=args.shift();
    if(a==="--artifacts" && args.length) out=resolve(args.shift());
    else if(["--generate","--verify"].includes(a) && mode===null) mode=a;
    else throw new Error("usage: envelope/build.mjs [--generate | --verify] [--artifacts directory]");
  }
  if(mode!=="--verify") {
    const b=await generateEnvelope(out);
    console.log(`Generated envelope: ${b.report.parts} parts / ${b.report.triangles} triangles. Verification is separate.`);
  }
  if(mode!=="--generate") await verifyEnvelope(out);
} catch(error) { console.error(error.message); process.exitCode=1; }
