# P18 A — React asset media types

`readReactAsset` now returns `text/javascript; charset=utf-8`, `text/css; charset=utf-8`, `image/svg+xml`, `image/png`, `image/webp`, and `font/woff2` for the six existing allowed extensions. The manifest filename grammar, membership check and request-to-filesystem boundary are unchanged. No server CSP or `nosniff` header changed.

An internal optional build-root argument lets tests provide an isolated manifest containing all six types, without modifying a real build or racing other tests. No request, URL parameter or environment variable chooses this root on either product host.

Tests use original synthetic 16px images and an original two-glyph geometric WOFF2 font. No vendor/system font, photo or brand asset is redistributed. Unit tests check exact bytes, media types, unlisted names, encoded/plain traversal and unsupported manifest paths. The browser executes the module, applies CSS and decodes SVG/PNG/WebP. It fetches WOFF2 over the existing self-only connect policy and decodes its ArrayBuffer with FontFace. The product CSP intentionally does not enable external CSS webfonts; this test does not relax it to do so.

Fresh Windows / Node 22.16.0 / Edge run, 2026-11-13:

- PASS `node --test test/react-mime.test.mjs`: 2 tests.
- PASS `npm test`: 187 tests, 0 failures (includes previous contracts).
- PASS `npm run build`: TypeScript and Vite.
- PASS `npm run test:browser:assets`: six types, 3 decoded images, loaded font, executed JS and applied CSS, no console/runtime/CSP errors.
- PASS `npm run test:browser:hosting`: Vite dev and copied staging complete the existing manual inspection journey.
- Existing production-host manifest/MIME/CSP tests still run against both actual hosts. Design exploration is a separate commit.

Raw evidence: `C:\CarScope-External\qr-ar-01\p18-design-exploration\asset-browser-report.json`, `mobile-unit.log`, `build.log`, `hosting.log`. No live phone, deployed HTTPS, vehicle or real AI validation was performed.
