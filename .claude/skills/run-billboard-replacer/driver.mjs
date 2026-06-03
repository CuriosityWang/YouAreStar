// Smoke-driver for the billboard-replacer web app.
//
// Drives a headless Chrome against an ALREADY-RUNNING Vite dev server and walks
// the core flow: gallery -> open a preset -> confirm the WebGL canvas actually
// drew -> upload an image -> confirm the composite -> export a PNG. Screenshots
// land in ./screenshots/ next to this file. Exits non-zero on any failure.
//
// Usage (from anywhere):
//   node .claude/skills/run-billboard-replacer/driver.mjs [url]
// Env:
//   CHROME_PATH  override the Chrome binary (default: macOS Google Chrome.app)
//   OUT          override the screenshot/download dir
//
// Requires puppeteer-core, installed in THIS directory (see package.json):
//   (cd .claude/skills/run-billboard-replacer && npm install)

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "/"));
const puppeteer = require("puppeteer-core");

const URL = process.argv[2] || "http://localhost:5173";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.OUT || join(HERE, "screenshots");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const ok = (name, pass, detail = "") => {
  checks.push({ name, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--window-size=1440,900",
    // WebGL in headless needs software rasterization or the canvas is blank:
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

try {
  // ---- gallery ----
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  const presets = await page.$$eval("button.preset-card", (e) => e.length);
  ok("gallery renders preset cards", presets > 0, `${presets} cards`);
  await page.screenshot({ path: join(OUT, "1-gallery.png") });

  // ---- open a preset -> editor ----
  await page.click("button.preset-card");
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1200); // WebGL draw + region-stats debounce

  // confirm the canvas actually drew (more than one distinct colour)
  const canvas = await page.$eval("canvas", (c) => {
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) return { hasGL: false, nonBlank: false };
    const seen = new Set();
    const px = new Uint8Array(4);
    for (let i = 0; i < 64; i++) {
      const x = ((i % 8) / 8) * c.width, y = (((i / 8) | 0) / 8) * c.height;
      gl.readPixels(x | 0, y | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      seen.add(px.join(","));
    }
    return { hasGL: true, nonBlank: seen.size > 1 };
  });
  ok("WebGL editor canvas drew a non-blank scene", canvas.hasGL && canvas.nonBlank);
  await page.screenshot({ path: join(OUT, "2-editor.png") });

  // ---- upload an image -> composite ----
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800; c.height = 500;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 800, 500);
    g.addColorStop(0, "#ff7a18"); g.addColorStop(1, "#1a2a6c");
    x.fillStyle = g; x.fillRect(0, 0, 800, 500);
    x.fillStyle = "#fff"; x.font = "bold 110px sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("SMOKE", 400, 250);
    return c.toDataURL("image/png");
  });
  const upload = join(OUT, "_upload.png");
  writeFileSync(upload, Buffer.from(dataUrl.split(",")[1], "base64"));
  const input = await page.$('input[type="file"]');
  await input.uploadFile(upload);
  await sleep(1800);
  const composited = await page.evaluate(() => ({
    thumbLoaded:
      document.querySelector(".dropzone-thumb")?.tagName === "IMG" &&
      document.querySelector(".dropzone-thumb").naturalWidth > 0,
    compareBtn: !!document.querySelector(".stage-compare"),
  }));
  ok("user image composited (sidebar thumb loads)", composited.thumbLoaded);
  ok("hold-to-compare control appears", composited.compareBtn);
  await page.screenshot({ path: join(OUT, "3-composited.png") });

  // ---- export a PNG ----
  // Hook URL.createObjectURL to capture the exported blob's type/size directly,
  // rather than chasing the flaky blob-download-to-disk in headless Chrome. This
  // proves renderToBlob() produced a real PNG.
  await page.evaluate(() => {
    window.__exportBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj) => {
      if (obj instanceof Blob) window.__exportBlob = { type: obj.type, size: obj.size };
      return orig(obj);
    };
    const b = [...document.querySelectorAll("button")].find((x) =>
      /导出|Export/.test(x.textContent || ""),
    );
    b && b.click();
  });
  // Full-res export under software WebGL (swiftshader) can take many seconds,
  // so poll generously before giving up.
  let blob = null;
  for (let i = 0; i < 80 && !blob; i++) {
    await sleep(300);
    blob = await page.evaluate(() => window.__exportBlob);
  }
  ok("export produces a PNG blob", !!blob && blob.type === "image/png" && blob.size > 1000,
     blob ? `${blob.type} ${(blob.size / 1024).toFixed(0)}KB` : "no blob captured");

  ok("no console errors on the happy path", consoleErrors.length === 0,
     consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "");
} finally {
  // close() can hang under swiftshader; don't let cleanup wedge the run.
  await Promise.race([browser.close().catch(() => {}), sleep(6000)]);
}

const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${failed ? "FAIL" : "PASS"} — ${checks.length - failed}/${checks.length} checks, screenshots in ${OUT}`);
process.exit(failed ? 1 : 0); // hard-exit so any lingering Chrome child can't keep us alive
