#!/usr/bin/env node
// P3-A5.1: copy a locally converted IONIQ 5 GLB into the DEBUG app's private files directory, where
// Ioniq5LabActivity serves it as ./model.glb. Same approach as tools/ioniq5-asset/push-debug-asset.ps1:
// `run-as` only works for debuggable installs, so a release build cannot receive the file this way.
// Nothing is written to shared storage; the temp copy in /data/local/tmp is removed afterwards.
//
//   node tools/three-poc/push-android-lab-model.mjs --glb=C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb
//   node tools/three-poc/push-android-lab-model.mjs --remove
// Options: --serial=emulator-5554
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const SERIAL = args.serial ?? "emulator-5554";
const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb.exe") : "adb";
const PKG = "io.carscope.app", TARGET = "files/debug-3d-assets/ioniq5.glb", MAX = 32 * 1024 * 1024;
const adb = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { encoding: "utf8", maxBuffer: 16 << 20 }).trim();

// AAOS runs apps as the current (non-system) user, e.g. 10; run-as defaults to user 0.
const user = adb("shell", "am get-current-user");
if (!/^\d+$/.test(user)) throw new Error(`Cannot read the current Android user: ${user}`);
const runAs = `run-as ${PKG} --user ${user}`;
if (!/uid=/.test(adb("shell", `${runAs} id`))) throw new Error("run-as failed: not a debuggable install of io.carscope.app?");

if (args.remove) {
  adb("shell", `${runAs} rm -f ${TARGET}`);
  console.log(`Removed ${TARGET} (user ${user})`);
} else {
  if (typeof args.glb !== "string") throw new Error("Missing --glb=<path to the converted IONIQ 5 GLB>");
  const bytes = statSync(args.glb).size;
  if (bytes <= 0 || bytes > MAX) throw new Error(`Size ${bytes} outside 1..${MAX}`);
  const sha = createHash("sha256").update(readFileSync(args.glb)).digest("hex");
  const tmp = "/data/local/tmp/carscope-ioniq5-lab.glb";
  adb("push", args.glb, tmp);
  try {
    // The shell user reads the temp file and pipes it into run-as (app uid): the app never reads /data/local/tmp.
    adb("shell", `cat ${tmp} | ${runAs} sh -c 'mkdir -p files/debug-3d-assets && cat > ${TARGET} && chmod 600 ${TARGET}'`);
  } finally {
    adb("shell", `rm -f ${tmp}`);
  }
  const remote = adb("shell", `${runAs} sha256sum ${TARGET}`).split(/\s+/)[0];
  if (remote !== sha) throw new Error(`SHA mismatch on device: ${remote} vs ${sha}`);
  console.log(`Pushed ${args.glb} -> ${PKG} (user ${user})/${TARGET} (${bytes} B, sha256 ${sha})`);
}
