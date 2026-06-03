// Mask-tool driver for the billboard-replacer web app.
//
// Extends the smoke driver to exercise the brush occlusion-mask feature against
// an ALREADY-RUNNING Vite dev server:
//   open a preset -> upload an ad -> enter Mask mode -> paint over the ad surface
//   -> confirm the WebGL composite is OCCLUDED where painted (the ad pixels are
//   replaced by the scene behind) -> Undo restores them -> export still yields a
//   PNG. Screenshots land in ./screenshots/. Exits non-zero on any failure.
//
// Usage:  node .claude/skills/run-billboard-replacer/mask-driver.mjs [url]
// Env:    CHROME_PATH, OUT  (same as driver.mjs)

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

// Sample the live WebGL canvas on a grid; returns an array of "r,g,b" strings.
// Same backing pixels before/after, so GL's bottom-left origin is irrelevant —
// we only compare like-for-like.
const sampleGrid = (n) =>
  // eslint-disable-next-line no-undef
  document.querySelector("canvas") &&
  (() => {
    const c = document.querySelector("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    const px = new Uint8Array(4);
    const out = [];
    for (let i = 0; i < n * n; i++) {
      const x = ((i % n) / n) * c.width;
      const y = (((i / n) | 0) / n) * c.height;
      gl.readPixels(x | 0, y | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(`${px[0]},${px[1]},${px[2]}`);
    }
    return out;
  })();

const changed = (a, b, thresh = 30) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const [r1, g1, b1] = a[i].split(",").map(Number);
    const [r2, g2, b2] = b[i].split(",").map(Number);
    if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > thresh) n++;
  }
  return n;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--window-size=1440,900",
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

const GRID = 14;

try {
  // ---- gallery -> first preset (known quad, left-of-center) ----
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  await page.click("button.preset-card");
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1200);

  // ---- upload an ad image -> composite onto the surface ----
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 500;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 800, 500);
    g.addColorStop(0, "#ff7a18");
    g.addColorStop(1, "#1a2a6c");
    x.fillStyle = g;
    x.fillRect(0, 0, 800, 500);
    return c.toDataURL("image/png");
  });
  const upload = join(OUT, "_mask_upload.png");
  writeFileSync(upload, Buffer.from(dataUrl.split(",")[1], "base64"));
  await (await page.$('input[type="file"]')).uploadFile(upload);
  await sleep(1600);
  const composited = await page.evaluate(
    () =>
      document.querySelector(".dropzone-thumb")?.tagName === "IMG" &&
      document.querySelector(".dropzone-thumb").naturalWidth > 0,
  );
  ok("ad image composited onto preset surface", composited);
  await page.screenshot({ path: join(OUT, "m1-composited.png") });

  // ---- enter Mask mode via the top-bar toggle ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".editor-bar-right button")].find(
      (x) => /^(蒙版|Mask)$/.test((x.textContent || "").trim()),
    );
    b && b.click();
  });
  const toolbarUp = await page
    .waitForSelector(".mask-toolbar", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  ok("Mask mode toolbar appears", toolbarUp);

  const gating = await page.evaluate(() => ({
    handlesHidden: !document.querySelector(".corner-layer"),
    compareHidden: !document.querySelector(".stage-compare"),
    brushLayer: !!document.querySelector(".mask-layer"),
  }));
  ok("corner handles + compare hidden in mask mode", gating.handlesHidden && gating.compareHidden);
  ok("brush layer mounted", gating.brushLayer);

  // ---- max brush size for a robust, visible stroke ----
  await page.evaluate(() => {
    const r = document.querySelector(".mask-toolbar input[type=range]");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(r, r.max);
    r.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // capture the composite BEFORE painting
  const before = await page.evaluate(sampleGrid, GRID);

  // ---- paint over the preset's ad surface (times-square-night quad ~ x:0.04–0.52, y:0.15–0.44) ----
  const holder = await page.evaluate(() => {
    const r = document.querySelector(".stage-canvas-holder").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const sx = (nx) => holder.left + nx * holder.width;
  const sy = (ny) => holder.top + ny * holder.height;
  // ONE continuous zigzag stroke covering the quad box => a single undo entry,
  // so one Undo click must fully restore it.
  await page.mouse.move(sx(0.08), sy(0.22));
  await page.mouse.down();
  for (const [nx, ny] of [[0.46, 0.22], [0.46, 0.3], [0.08, 0.3], [0.08, 0.38], [0.46, 0.38]]) {
    await page.mouse.move(sx(nx), sy(ny));
  }
  await page.mouse.up();
  await sleep(500); // rAF flush + render

  await page.screenshot({ path: join(OUT, "m2-painted.png") });
  const after = await page.evaluate(sampleGrid, GRID);
  const paintedChange = changed(before, after);
  ok(
    "painting occludes the ad in the live WebGL composite",
    paintedChange >= 8,
    `${paintedChange}/${GRID * GRID} sampled px changed`,
  );

  // ---- Undo restores the occluded pixels ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".mask-toolbar .mt-btn")].find((x) =>
      /撤销|Undo/.test(x.textContent || ""),
    );
    b && b.click();
  });
  await sleep(500);
  const afterUndo = await page.evaluate(sampleGrid, GRID);
  const undoResidual = changed(before, afterUndo);
  ok(
    "Undo restores the composite (occlusion removed)",
    undoResidual <= 2,
    `${undoResidual}/${GRID * GRID} px still differ from pre-paint`,
  );
  await page.screenshot({ path: join(OUT, "m3-undone.png") });

  // ---- re-paint, then export: the PNG must bake in the occlusion ----
  await page.mouse.move(sx(0.08), sy(0.22));
  await page.mouse.down();
  for (const [nx, ny] of [[0.46, 0.22], [0.46, 0.3], [0.08, 0.3], [0.08, 0.38], [0.46, 0.38]]) {
    await page.mouse.move(sx(nx), sy(ny));
  }
  await page.mouse.up();
  await sleep(400);

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
  let blob = null;
  for (let i = 0; i < 80 && !blob; i++) {
    await sleep(300);
    blob = await page.evaluate(() => window.__exportBlob);
  }
  ok(
    "export with mask produces a PNG blob",
    !!blob && blob.type === "image/png" && blob.size > 1000,
    blob ? `${blob.type} ${(blob.size / 1024).toFixed(0)}KB` : "no blob",
  );

  ok("no console errors during the mask flow", consoleErrors.length === 0,
     consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "");
} finally {
  await Promise.race([browser.close().catch(() => {}), sleep(6000)]);
}

const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${failed ? "FAIL" : "PASS"} — ${checks.length - failed}/${checks.length} checks, screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
