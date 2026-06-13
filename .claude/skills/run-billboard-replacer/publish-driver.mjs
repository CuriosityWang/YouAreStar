// Drives POST /__publish-template end-to-end against a running dev server:
// publishes a synthetic template, asserts the bg + mask files were written and
// billboards.json upserted, then restores the manifest and deletes the test
// assets so the repo is left clean. Run with the dev server up:
//   npm run dev & until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
//   node .claude/skills/run-billboard-replacer/publish-driver.mjs
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = process.argv[2] ?? "http://localhost:5173";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = path.join(repo, "src/data/billboards.json");
const billboardsDir = path.join(repo, "public/billboards");
const TEST_ID = "zz-publish-driver-test";

// 1x1 transparent PNG (base64) reused for bg + mask.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let pass = 0;
let fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  cond ? pass++ : fail++;
};

const before = await fs.readFile(manifestPath, "utf8");
try {
  const res = await fetch(`${ORIGIN}/__publish-template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: TEST_ID,
      name: { en: "Driver Test", zh: "驱动测试" },
      caption: { en: "synthetic", zh: "合成" },
      corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
      bg: { base64: PNG_1x1, ext: "png" },
      maskPng: PNG_1x1,
    }),
  });
  const data = await res.json();
  check(res.ok && data.ok, `endpoint returned ok (${res.status})`);
  check(data.src === `/billboards/${TEST_ID}.png`, `src is ${data.src}`);
  check(data.mask === `/billboards/${TEST_ID}-mask.png`, `mask is ${data.mask}`);

  const bgStat = await fs.stat(path.join(billboardsDir, `${TEST_ID}.png`)).then(() => true).catch(() => false);
  const maskStat = await fs.stat(path.join(billboardsDir, `${TEST_ID}-mask.png`)).then(() => true).catch(() => false);
  check(bgStat, "background PNG written to public/billboards/");
  check(maskStat, "mask PNG written to public/billboards/");

  const list = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const entry = list.find((p) => p.id === TEST_ID);
  check(!!entry, "manifest upserted with the new entry");
  check(entry?.mask === `/billboards/${TEST_ID}-mask.png`, "entry carries the mask path");

  // reject path: bad id (path traversal)
  const badRes = await fetch(`${ORIGIN}/__publish-template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "../escape" }),
  });
  check(badRes.status === 400, "rejects unsafe id with 400");
} finally {
  // restore manifest + delete test assets so the repo stays clean
  await fs.writeFile(manifestPath, before, "utf8");
  await fs.rm(path.join(billboardsDir, `${TEST_ID}.png`), { force: true });
  await fs.rm(path.join(billboardsDir, `${TEST_ID}-mask.png`), { force: true });
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
