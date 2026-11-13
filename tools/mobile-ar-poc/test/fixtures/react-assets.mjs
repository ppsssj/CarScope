// Original synthetic fixtures: 16px solid-color images and a two-glyph geometric font.
// No third-party brand, photograph, system font or license-restricted material.
export const binaryAssets = {
  png: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAL0lEQVR4AeyTMQ0AAAzCCE7mZ/6FzMCWaeDggYSXo6GcrlVKiMkAEAZh8Br5f3AAAAD//zqizP0AAAAGSURBVAMAYQsmAY10p1sAAAAASUVORK5CYII=",
  webp: "UklGRh4CAABXRUJQVlA4WAoAAAAgAAAADwAADwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggMAAAAPABAJ0BKhAAEAABQCYloAJ0ugH4AARMAAD+2ib/5+Z3bi/qt/97BfegHvQD+vgAAA==",
  woff2:
    "d09GMgABAAAAAAGwAAoAAAAAA+QAAAFmAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAANAowQAE2AiQDBgsGAAQgBYM/ByYbOAMArgZs1xrpoHRZ7r8cx6aiaTGainTyhgjqx3579943TKTRxBLT6aRISJ4phdBJhSF09///WvdNpMgHmQCdMyDdm80cZAuyCcID2aW46v0SIMao/wHqgf/9Tf7r/AusMMqjkNc4jxIqyh5ga5AnkMcRRBgQpttEEfURhGoN+qKjNyqZ0RBV6Qzo+BSccgpHlKV3ALJgThSMZBHGagG1Gjj9J88YApCgItFED6CCEIXX2zoL7/exnN4GBIKv97X9vR38H/ic4RLXPMg29wUUCYLT/FjeAF5DEAAgMgMQSEWABABAjxcEwgACpJYBAYoh4wJUEzYFaOh2ikDTuGu8qCrCgtuxSH3uRLHiXlQH3kTDmI9G055vt788a9Vfv273y/xLFbjUzpoN0MHVtcy0YYEx41vC1bsIjY5OZsyVtZebu4tZYLZ0t9PbcZA5LIiXJ2Z+tc4OLKt7DpggtzMGcJqLSVcAAAAA",
};
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
export async function createAssetFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "carscope-mime-"));
  await mkdir(path.join(directory, ".vite"));
  await mkdir(path.join(directory, "react-assets"));
  const files = {
    js: Buffer.from("document.documentElement.dataset.fixtureScript='loaded';"),
    css: Buffer.from(
      "body{--fixture-css:loaded}.font-test{font-family:CarScopeFixture}",
    ),
    svg: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path fill="#f24c21" d="M0 0h16v16H0z"/></svg>',
    ),
    ...Object.fromEntries(
      Object.entries(binaryAssets).map(([ext, value]) => [
        ext,
        Buffer.from(value, "base64"),
      ]),
    ),
  };
  for (const [ext, bytes] of Object.entries(files))
    await writeFile(path.join(directory, `react-assets/fixture.${ext}`), bytes);
  await writeFile(
    path.join(directory, ".vite/manifest.json"),
    JSON.stringify({
      "index.html": {
        file: "react-assets/fixture.js",
        css: ["react-assets/fixture.css"],
        assets: [
          "react-assets/fixture.svg",
          "react-assets/fixture.png",
          "react-assets/fixture.webp",
          "react-assets/fixture.woff2",
        ],
      },
    }),
  );
  return { directory, root: pathToFileURL(directory + path.sep), files };
}
