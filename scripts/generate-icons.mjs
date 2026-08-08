// scripts/generate-icons.mjs
// Generates a multi-resolution Windows ICO from app/favicon.ico (a 512x512 PNG
// mislabeled .ico) so electron-builder can embed it into the exe. Pure-JS ICO
// encoder + sharp (already installed via Next.js) — no new dependency.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(root, "app", "favicon.ico");
const OUT_DIR = path.join(root, "electron", "icons");
const OUT = path.join(OUT_DIR, "icon.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Encode [{size, png}] into a valid .ico using PNG-encoded entries
// (supported by Windows Vista+ and Electron's rcedit embedding).
function encodeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const { size, png } = images[i];
    const o = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, o + 0); // width  (0 means 256)
    entries.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    entries.writeUInt8(0, o + 2); // color count (0 = >=256)
    entries.writeUInt8(0, o + 3); // reserved
    entries.writeUInt16LE(1, o + 4); // color planes
    entries.writeUInt16LE(32, o + 6); // bits per pixel
    entries.writeUInt32LE(png.length, o + 8); // image size
    entries.writeUInt32LE(offset, o + 12); // image offset
    offset += png.length;
  }
  return Buffer.concat([header, entries, ...images.map((i) => i.png)]);
}

async function main() {
  const srcPng = await readFile(SOURCE);
  const meta = await sharp(srcPng).metadata();
  if (meta.width !== meta.height) {
    throw new Error(`source favicon is not square: ${meta.width}x${meta.height}`);
  }
  const images = [];
  for (const size of SIZES) {
    const png = await sharp(srcPng).resize(size, size).png().toBuffer();
    images.push({ size, png });
  }
  const ico = encodeIco(images);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, ico);

  // Self-validate: ICO magic (00 00 01 00) + entry count.
  const written = await readFile(OUT);
  const ok = written[0] === 0 && written[1] === 0 && written[2] === 1 && written[3] === 0;
  const entries = written.readUInt16LE(4);
  if (!ok || entries !== SIZES.length) {
    throw new Error(`generated ICO is malformed (magic ok=${ok}, entries=${entries})`);
  }
  console.log(`[generate-icons] wrote ${OUT} (${SIZES.length} sizes: ${SIZES.join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
