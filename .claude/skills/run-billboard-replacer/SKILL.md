---
name: run-billboard-replacer
description: Build, launch, run, drive, smoke-test, verify, or screenshot the billboard-replacer web app (Vite + React + raw WebGL). Use when asked to run/start/preview the app, confirm a change works in the real browser, screenshot a scene, or verify the homography-warp + color-match composite end-to-end.
---

# Run & drive billboard-replacer

A browser app that composites a user image into a billboard's ad surface via a
WebGL homography warp + Reinhard color match. There is **no test runner** — you
verify it by driving a real headless Chrome.

The agent path is a committed smoke-driver,
[`driver.mjs`](driver.mjs), built on `puppeteer-core` against the system Chrome.
It walks the core flow (gallery → open preset → confirm the WebGL canvas drew →
upload an image → confirm the composite → export a PNG), prints PASS/FAIL, and
drops screenshots in `screenshots/`.

Two feature drivers extend it: [`mask-driver.mjs`](mask-driver.mjs) (brush
occlusion mask) and [`saved-driver.mjs`](saved-driver.mjs) (saved templates:
save → IndexedDB record + mask round-trip → reload → reopen → update-in-place
→ delete). Run them the same way; both expect the dev server to be up.

All paths below are relative to the repo root.

## Prerequisites

- **Node** (v22 verified) and **npm**.
- **Google Chrome** installed. The driver defaults to the macOS path
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; override with
  `CHROME_PATH=/path/to/chrome` if yours differs.
- One-time: install the driver's own deps (kept out of the app's `package.json`
  so the app stays dependency-light). `puppeteer-core` pulls **no** browser —
  it uses the Chrome above.

```bash
cd .claude/skills/run-billboard-replacer && npm install && cd -
```

## Run (agent path — this is the one to use)

Start the dev server, wait for the port, then run the driver:

```bash
npm run dev &
until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
node .claude/skills/run-billboard-replacer/driver.mjs
```

Expected tail (≈15–25s; software WebGL is slow):

```
  PASS  gallery renders preset cards — 5 cards
  PASS  WebGL editor canvas drew a non-blank scene
  PASS  user image composited (sidebar thumb loads)
  PASS  hold-to-compare control appears
  PASS  export produces a PNG blob — image/png 7791KB
  PASS  no console errors on the happy path

PASS — 6/6 checks, screenshots in .../screenshots
```

Exit code is 0 on all-pass, 1 on any failure. **Look at the screenshots** in
`.claude/skills/run-billboard-replacer/screenshots/` (`1-gallery.png`,
`2-editor.png`, `3-composited.png`) — a blank/error frame is a failure even if
checks pass. Pass a different URL as the first arg to target another origin
(default `http://localhost:5173`).

Stop the server when done:

```bash
pkill -f 'vite'
```

## Run (human path)

```bash
npm run dev
```

Vite serves on `http://localhost:5173` and auto-opens a browser. Useful for
eyeballing; useless headless (no driver = nothing clicks the buttons).

## Gotchas

- **WebGL is blank in headless without software rendering.** The driver launches
  Chrome with `--use-gl=angle --use-angle=swiftshader --enable-webgl
  --ignore-gpu-blocklist --enable-unsafe-swiftshader`. Drop these and
  `2-editor.png` comes back empty even though the page "loaded."
- **Export is slow and was flaky to capture.** `renderToBlob()` spins up a
  throwaway full-res (up to 2400px) renderer; under swiftshader that can take
  several seconds. The driver polls up to ~24s for it.
- **Don't chase the download to disk.** The export triggers an `<a download>`
  blob click; capturing that file via CDP `Page.setDownloadBehavior` is
  unreliable headless. The driver instead hooks `URL.createObjectURL` in-page to
  read the exported blob's type/size directly — that proves the PNG was made.
- **UI language follows the system locale.** On a zh-CN machine the buttons read
  "导出 PNG" etc.; the driver matches both `导出` and `Export`.
- **`browser.close()` can wedge under swiftshader.** The driver races it against
  a 6s timeout and hard-exits, or a passing run can hang and look like a hang.
- **To confirm the canvas truly drew**, the driver reads pixels off the WebGL
  context (`gl.readPixels`) and asserts >1 distinct colour — a loaded `<canvas>`
  element alone proves nothing.

## Troubleshooting

- **`Error: ... net::ERR_CONNECTION_REFUSED`** → dev server isn't up. Run the
  `npm run dev &` + `curl` wait first.
- **`Could not find Chrome` / spawn ENOENT** → set `CHROME_PATH` to your Chrome
  binary.
- **`EADDRINUSE :5173`** → a dev server is already running; reuse it (skip the
  launch) or `pkill -f vite` first.
- **Blank `2-editor.png`** → the swiftshader flags above are missing or your
  Chrome is too old to honor `--enable-unsafe-swiftshader`.
