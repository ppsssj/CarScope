// P2-A7 SVG vs GLB check. Start the server first:
//   CARSCOPE_IONIQ5_GLB=<glb> CARSCOPE_IONIQ5_SVG_DIR=<anatomy-svg.mjs --out dir> node tools/three-poc/serve.mjs
//   node tools/three-poc/check-ioniq5-svg.mjs [url] [shot.png]
// Fails unless silhouette IoU >= 0.98, part agreement >= 0.97 and every hit test picks the expected part.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
const shot = resolve(process.argv[3] ?? join(tmpdir(), "ioniq5-svg-compare.png"));
const actions = [
  ["until", "window.__cmp?.done", 60000],
  ["eval", "(() => { const r=window.__cmp; if(r.error) throw Error(r.error); return r; })()"],
  ["shot", shot, "body"],
  ["eval", "(() => { const r=window.__cmp, bad=[]; if(r.silhouetteIoU<0.98) bad.push('silhouette IoU '+r.silhouetteIoU); if(r.partAgreement<0.97) bad.push('part agreement '+r.partAgreement); if(r.undecoded) bad.push('undecoded '+r.undecoded); for(const p of r.picks) if(p.picked!==p.expected) bad.push('pick '+p.expected+' -> '+p.picked); if(bad.length) throw Error(bad.join('; ')); return 'PASS'; })()"],
];
const file = join(mkdtempSync(join(tmpdir(), "ioniq5-svg-")), "actions.json");
writeFileSync(file, JSON.stringify(actions));
const r = spawnSync(process.execPath, [join(anatomy, "scripts", "drive.mjs"), process.argv[2] ?? "http://127.0.0.1:8095/ioniq5-svg.html", "--actions", file, "--width", "1924", "--height", "1300"], { stdio: "inherit" });
process.exitCode = r.status ?? 1;
