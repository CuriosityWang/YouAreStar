// Saved-scenes (user templates) driver for the billboard-replacer web app.
//
// Drives an ALREADY-RUNNING Vite dev server through the full template
// lifecycle:
//   wipe IDB -> upload a custom background -> drag the TL corner -> paint a
//   mask -> Save as template (named) -> assert the IndexedDB record (corners,
//   mask PNG pixels, thumb) -> reload -> "My Templates" card appears -> open
//   it -> canvas draws + tag reads "Saved template" -> Update template keeps
//   ONE record -> save a preset copy (2 records) -> two-click delete empties
//   the section -> reload stays empty.
//
// Usage:  node .claude/skills/run-billboard-replacer/saved-driver.mjs [url]
// Env:    CHROME_PATH, OUT  (same as driver.mjs)

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "/"));
const puppeteer = require("puppeteer-core");

const URL_ = process.argv[2] || "http://localhost:5173";
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

// Read all SavedScene records (summarized, blob -> size) out of IndexedDB.
const readRecords = () =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open("billboard-replacer");
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("scenes")) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction("scenes", "readonly");
      const all = tx.objectStore("scenes").getAll();
      all.onsuccess = () => {
        db.close();
        resolve(
          all.result.map((r) => ({
            id: r.id,
            name: r.name,
            corners: r.corners,
            bgSize: r.bgBlob ? r.bgBlob.size : 0,
            maskSize: r.maskBlob ? r.maskBlob.size : null,
            thumbSize: r.thumbBlob ? r.thumbBlob.size : 0,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        );
      };
      all.onerror = () => {
        db.close();
        reject(all.error);
      };
    };
    open.onerror = () => reject(open.error);
  });

// Decode the FIRST record's maskBlob and return the white-pixel ratio inside
// the given normalized box — proves the painted mask survived the round-trip.
const maskWhiteRatio = (box) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open("billboard-replacer");
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("scenes", "readonly");
      const all = tx.objectStore("scenes").getAll();
      all.onsuccess = async () => {
        db.close();
        const rec = all.result[0];
        if (!rec || !rec.maskBlob) {
          resolve(-1);
          return;
        }
        const bmp = await createImageBitmap(rec.maskBlob);
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const x = c.getContext("2d");
        x.drawImage(bmp, 0, 0);
        const d = x.getImageData(
          Math.round(box.x0 * bmp.width),
          Math.round(box.y0 * bmp.height),
          Math.max(1, Math.round((box.x1 - box.x0) * bmp.width)),
          Math.max(1, Math.round((box.y1 - box.y0) * bmp.height)),
        ).data;
        let white = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200) white++;
        resolve(white / (d.length / 4));
      };
      all.onerror = () => {
        db.close();
        reject(all.error);
      };
    };
    open.onerror = () => reject(open.error);
  });

// Canvas drew something non-blank (>1 distinct color on a sample grid).
const canvasColors = () => {
  const c = document.querySelector("canvas");
  if (!c) return 0;
  const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
  const px = new Uint8Array(4);
  const seen = new Set();
  const n = 10;
  for (let i = 0; i < n * n; i++) {
    const x = (((i % n) / n) * c.width) | 0;
    const y = ((((i / n) | 0) / n) * c.height) | 0;
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    seen.add(`${px[0]},${px[1]},${px[2]}`);
  }
  return seen.size;
};

const clickByText = (selector, re) => {
  const rx = new RegExp(re);
  const b = [...document.querySelectorAll(selector)].find((x) =>
    rx.test((x.textContent || "").trim()),
  );
  if (b) b.click();
  return !!b;
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

try {
  // ---- clean slate: wipe the DB, then load fresh ----
  await page.goto(URL_, { waitUntil: "networkidle2", timeout: 30000 });
  await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.deleteDatabase("billboard-replacer");
        r.onsuccess = r.onerror = r.onblocked = () => res(null);
      }),
  );
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  const noSaved = await page.evaluate(() => !document.querySelector(".saved-card"));
  ok("clean start: no My Templates section", noSaved);

  // ---- upload a custom background via the BYO card ----
  const bgUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 800;
    const x = c.getContext("2d");
    x.fillStyle = "#28425c";
    x.fillRect(0, 0, 1200, 800);
    x.fillStyle = "#d9c9a3";
    x.fillRect(300, 200, 600, 360); // a flat "billboard" slab
    return c.toDataURL("image/png");
  });
  const bgFile = join(OUT, "_saved_bg.png");
  writeFileSync(bgFile, Buffer.from(bgUrl.split(",")[1], "base64"));
  await (await page.$('.byo-card input[type="file"]')).uploadFile(bgFile);
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1200);

  // ---- drag the TL corner handle (index 0) to ~(0.20, 0.22) of the layer ----
  const layer = await page.evaluate(() => {
    const r = document.querySelector(".corner-layer").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const handle = await page.evaluate(() => {
    const h = document.querySelectorAll(".corner-layer .handle")[0].getBoundingClientRect();
    return { x: h.left + h.width / 2, y: h.top + h.height / 2 };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(layer.left + 0.2 * layer.width, layer.top + 0.22 * layer.height, {
    steps: 8,
  });
  await page.mouse.up();
  await sleep(400);

  // ---- paint a mask stroke across the middle of the stage ----
  await page.evaluate(clickByText, ".editor-bar-right button", "^(蒙版|Mask)$");
  await page.waitForSelector(".mask-toolbar", { timeout: 5000 });
  await page.evaluate(() => {
    const r = document.querySelector(".mask-toolbar input[type=range]");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(r, r.max);
    r.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const holder = await page.evaluate(() => {
    const r = document.querySelector(".stage-canvas-holder").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const sx = (nx) => holder.left + nx * holder.width;
  const sy = (ny) => holder.top + ny * holder.height;
  await page.mouse.move(sx(0.3), sy(0.5));
  await page.mouse.down();
  await page.mouse.move(sx(0.7), sy(0.5), { steps: 12 });
  await page.mouse.up();
  await sleep(500);
  await page.evaluate(clickByText, ".editor-bar-right button", "^(完成|Done)$");
  await sleep(300);

  // ---- save as template, named ----
  const saveBtn = await page.evaluate(
    clickByText,
    ".export-bar button",
    "存为模板|Save as template",
  );
  ok("Save-as-template button present", saveBtn);
  await page.waitForSelector(".save-name", { timeout: 5000 });
  await page.evaluate(() => {
    const i = document.querySelector(".save-name");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(i, "CDP Template");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(clickByText, ".save-row button", "^(保存|Save)$");
  const savedToast = await page
    .waitForFunction(
      () => /模板已保存|Template saved/.test(document.body.textContent || ""),
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  ok("save shows the saved toast", savedToast);
  await page.screenshot({ path: join(OUT, "s1-saved.png") });

  // ---- IDB record assertions ----
  let recs = await page.evaluate(readRecords);
  ok("exactly one record after first save", recs.length === 1, `${recs.length} records`);
  const r0 = recs[0] || {};
  ok("record name persisted", r0.name === "CDP Template", r0.name);
  ok(
    "dragged TL corner persisted",
    !!r0.corners &&
      Math.abs(r0.corners[0][0] - 0.2) < 0.05 &&
      Math.abs(r0.corners[0][1] - 0.22) < 0.05,
    JSON.stringify(r0.corners && r0.corners[0]),
  );
  ok(
    "bg + thumb blobs non-empty",
    r0.bgSize > 1000 && r0.thumbSize > 500,
    `bg ${r0.bgSize}B thumb ${r0.thumbSize}B`,
  );
  ok("mask blob stored", r0.maskSize !== null && r0.maskSize > 100, `${r0.maskSize}B`);
  const ratio = await page.evaluate(maskWhiteRatio, { x0: 0.35, y0: 0.45, x1: 0.65, y1: 0.55 });
  ok("mask PNG has white paint where stroked", ratio > 0.3, `white ratio ${ratio.toFixed(2)}`);
  const updatedAt1 = r0.updatedAt;

  // ---- button flips to Update; update-in-place keeps ONE record ----
  await sleep(1100); // ensure updatedAt strictly increases
  const updBtn = await page.evaluate(clickByText, ".export-bar button", "更新模板|Update template");
  ok("button reads Update template after save", updBtn);
  await page.waitForSelector(".save-name", { timeout: 5000 });
  await page.evaluate(clickByText, ".save-row button", "^(保存|Save)$");
  await sleep(1500);
  recs = await page.evaluate(readRecords);
  ok(
    "re-save updates in place (1 record, newer updatedAt)",
    recs.length === 1 && recs[0].updatedAt > updatedAt1,
    `${recs.length} records`,
  );

  // ---- reload: My Templates card appears; open it ----
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".saved-card", { timeout: 15000 });
  const cardName = await page.evaluate(
    () => document.querySelector(".saved-card .preset-name")?.textContent,
  );
  ok("saved card survives reload with its name", cardName === "CDP Template", cardName || "none");
  await page.screenshot({ path: join(OUT, "s2-gallery.png") });
  await page.click(".saved-card");
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1500);
  const colors = await page.evaluate(canvasColors);
  ok("reopened template renders a non-blank scene", colors > 1, `${colors} distinct colors`);
  const tag = await page.evaluate(
    () => document.querySelector(".editor-source .tag")?.textContent,
  );
  ok("tag reads Saved template", /已存模板|Saved template/.test(tag || ""), tag || "none");
  await page.screenshot({ path: join(OUT, "s3-reopened.png") });

  // ---- back to gallery; save a PRESET as a second template ----
  await page.click(".editor-back");
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  await page.click("button.preset-card");
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1200);
  await page.evaluate(clickByText, ".export-bar button", "存为模板|Save as template");
  await page.waitForSelector(".save-name", { timeout: 5000 });
  await page.evaluate(clickByText, ".save-row button", "^(保存|Save)$");
  await page
    .waitForFunction(
      () => /模板已保存|Template saved/.test(document.body.textContent || ""),
      { timeout: 20000 },
    )
    .catch(() => {});
  recs = await page.evaluate(readRecords);
  const presetRec = recs.find((r) => r.name !== "CDP Template");
  ok("preset saved as a second template", recs.length === 2, `${recs.length} records`);
  ok(
    "preset record holds fetched background bytes",
    !!presetRec && presetRec.bgSize > 10000,
    presetRec ? `${presetRec.bgSize}B` : "missing",
  );

  // ---- two-click delete both cards; section disappears and stays gone ----
  await page.click(".editor-back");
  await page.waitForSelector(".saved-card", { timeout: 15000 });
  for (let guard = 0; guard < 4; guard++) {
    const left = await page.evaluate(() => document.querySelectorAll(".saved-card").length);
    if (!left) break;
    await page.evaluate(() => document.querySelector(".saved-card .saved-delete").click());
    await sleep(150);
    const armed = await page.evaluate(
      () => !!document.querySelector(".saved-card .saved-delete[data-armed]"),
    );
    if (guard === 0) ok("first delete click arms (does not delete)", armed);
    await page.evaluate(() => document.querySelector(".saved-card .saved-delete").click());
    await sleep(300);
  }
  const sectionGone = await page.evaluate(() => !document.querySelector(".saved-collection"));
  ok("deleting all cards hides the section", sectionGone);
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  const stillGone = await page.evaluate(() => !document.querySelector(".saved-collection"));
  recs = await page.evaluate(readRecords);
  ok("deletion persists across reload", stillGone && recs.length === 0, `${recs.length} records`);

  ok(
    "no console errors during the saved-scenes flow",
    consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "",
  );
} finally {
  await Promise.race([browser.close().catch(() => {}), sleep(6000)]);
}

const failed = checks.filter((c) => !c.pass).length;
console.log(
  `\n${failed ? "FAIL" : "PASS"} — ${checks.length - failed}/${checks.length} checks, screenshots in ${OUT}`,
);
process.exit(failed ? 1 : 0);
