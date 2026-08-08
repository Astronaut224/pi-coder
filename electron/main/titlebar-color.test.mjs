import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./titlebar-color.ts");
}

test("parseHex parses #rrggbb, #rgb, and bare hex", async () => {
  const { parseHex } = await loadSubject();
  assert.deepEqual(parseHex("#f8f8f6"), { r: 248, g: 248, b: 246 });
  assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex("24231f"), { r: 36, g: 35, b: 31 });
});

test("parseHex rejects garbage", async () => {
  const { parseHex } = await loadSubject();
  assert.throws(() => parseHex("not-a-color"));
});

test("contrastSymbolColor: light bg -> black, dark bg -> white", async () => {
  const { contrastSymbolColor } = await loadSubject();
  assert.equal(contrastSymbolColor("#f8f8f6"), "#000000");
  assert.equal(contrastSymbolColor("#ffffff"), "#000000");
  assert.equal(contrastSymbolColor("#24231f"), "#ffffff");
  assert.equal(contrastSymbolColor("#000000"), "#ffffff");
});

test("initialOverlayColors dark/light", async () => {
  const { initialOverlayColors } = await loadSubject();
  assert.deepEqual(initialOverlayColors(true), { color: "#24231f", symbolColor: "#ffffff" });
  assert.deepEqual(initialOverlayColors(false), { color: "#f8f8f6", symbolColor: "#000000" });
});
