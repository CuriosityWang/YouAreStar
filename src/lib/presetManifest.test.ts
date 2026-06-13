import assert from "node:assert/strict";
import {
  slug,
  isSafeId,
  mimeToExt,
  isAllowedExt,
  isValidCorners,
  isLocalizedText,
  upsertPreset,
  type PresetEntry,
} from "./presetManifest";

// slug
assert.equal(slug("Times Square — Night!"), "times-square-night");
assert.equal(slug("   "), "scene");
assert.equal(slug("已经"), "scene"); // non-latin collapses to fallback

// isSafeId
assert.equal(isSafeId("times-square-night"), true);
assert.equal(isSafeId("../etc/passwd"), false);
assert.equal(isSafeId("-leading"), false);
assert.equal(isSafeId("UPPER"), false);
assert.equal(isSafeId(""), false);

// mimeToExt / isAllowedExt
assert.equal(mimeToExt("image/jpeg"), "jpg");
assert.equal(mimeToExt("image/svg+xml"), "svg");
assert.equal(mimeToExt("image/gif"), null);
assert.equal(isAllowedExt("PNG"), true);
assert.equal(isAllowedExt("gif"), false);

// isValidCorners
assert.equal(isValidCorners([[0, 0], [1, 0], [1, 1], [0, 1]]), true);
assert.equal(isValidCorners([[0, 0], [1, 0], [1, 1]]), false); // too few
assert.equal(isValidCorners([[0, 0], [1, 0], [1, 1], [0, 1.2]]), false); // out of range

// isLocalizedText
assert.equal(isLocalizedText({ en: "a", zh: "啊" }), true);
assert.equal(isLocalizedText({ en: "a", zh: "" }), false);
assert.equal(isLocalizedText({ en: "a" }), false);

// upsertPreset: append when id is new
const base: PresetEntry[] = [
  { id: "a", name: { en: "A", zh: "A" }, caption: { en: "", zh: "" }, src: "/billboards/a.jpg", corners: [[0, 0], [1, 0], [1, 1], [0, 1]] },
];
const appended = upsertPreset(base, {
  id: "b", name: { en: "B", zh: "B" }, caption: { en: "", zh: "" }, src: "/billboards/b.jpg", corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
});
assert.equal(appended.length, 2);
assert.equal(appended[1].id, "b");
assert.equal(base.length, 1); // input not mutated

// upsertPreset: replace in place (position preserved), add mask
const two: PresetEntry[] = [
  { id: "a", name: { en: "A", zh: "A" }, caption: { en: "", zh: "" }, src: "/billboards/a.jpg", corners: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { id: "b", name: { en: "B", zh: "B" }, caption: { en: "", zh: "" }, src: "/billboards/b.jpg", corners: [[0, 0], [1, 0], [1, 1], [0, 1]] },
];
const replaced = upsertPreset(two, {
  id: "a", name: { en: "A2", zh: "A2" }, caption: { en: "", zh: "" }, src: "/billboards/a.jpg", corners: [[0, 0], [1, 0], [1, 1], [0, 1]], mask: "/billboards/a-mask.png",
});
assert.equal(replaced.length, 2);
assert.equal(replaced[0].name.en, "A2");
assert.equal(replaced[0].mask, "/billboards/a-mask.png");
assert.equal(replaced[1].id, "b"); // order preserved

console.log("presetManifest.test.ts: all assertions passed");
