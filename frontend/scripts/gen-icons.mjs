// Generates the PWA icon set (favicon.ico, apple-touch-icon.png, icon-*.png,
// icon-maskable-*.png, og-image.png) programmatically — no design tooling or
// native image deps (canvas/sharp) available in this environment. Draws a
// simple on-brand "reel roulette" mark (gold ring + spokes, green hub +
// pointer) on the ink background using a hand-rolled PNG encoder (zlib is
// Node built-in; nothing else is needed).
//
// This is a placeholder generator per the v1 design's PWA task — swap for
// real exported brand art in `assets/` when available. Re-run with:
//   node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public");

// --- brand palette ---------------------------------------------------
const INK = [0x10, 0x14, 0x1a, 255];
const GOLD = [0xd4, 0xa9, 0x43, 255];
const GREEN = [0x3f, 0xae, 0x6a, 255];
const CREAM = [0xe8, 0xe0, 0xcc, 255];

// --- tiny PNG encoder (RGBA8, no interlace) ---------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** rgba: Uint8Array/Buffer of length width*height*4 */
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  // raw scanlines: filter byte 0 + width*4 bytes per row
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idatData = deflateSync(raw, { level: 9 });
  const idat = chunk("IDAT", idatData);

  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// --- pixel canvas with 4x supersampling for cheap AA -------------------
function setPx(buf, size, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  buf[i] = rgba[0];
  buf[i + 1] = rgba[1];
  buf[i + 2] = rgba[2];
  buf[i + 3] = rgba[3];
}

function downsample(hiBuf, hiSize, factor) {
  const size = hiSize / factor;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const n = factor * factor;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          const sy = y * factor + dy;
          const i = (sy * hiSize + sx) * 4;
          r += hiBuf[i];
          g += hiBuf[i + 1];
          b += hiBuf[i + 2];
          a += hiBuf[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * Draws the "reel roulette" mark: gold ring with cream sprocket spokes,
 * a green hub, and a green pointer wedge aimed at 12 o'clock.
 *
 * markRadiusFrac: outer ring radius as a fraction of size/2.
 * pointerTipFrac: how far the pointer tip extends, as a fraction of size/2
 *   (standard icons let this reach ~1.0 — touching the edge; maskable
 *   variants must keep it inside the 0.8 safe-zone radius, i.e. <= 0.4).
 */
function drawMark(size, { markRadiusFrac, pointerTipFrac, background = INK }) {
  const SS = 4; // supersample factor
  const hi = size * SS;
  const buf = Buffer.alloc(hi * hi * 4);

  // background fill
  for (let y = 0; y < hi; y++) {
    for (let x = 0; x < hi; x++) setPx(buf, hi, x, y, background);
  }

  const cx = hi / 2;
  const cy = hi / 2;
  const R = (hi / 2) * markRadiusFrac; // outer ring radius
  const ringThickness = R * 0.16;
  const ringInner = R - ringThickness;
  const hubR = R * 0.28;
  const pointerTip = (hi / 2) * pointerTipFrac;
  const spokeCount = 8;
  const spokeHalfAngle = 0.045; // radians, angular half-width of a spoke

  for (let y = 0; y < hi; y++) {
    for (let x = 0; x < hi; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx); // -PI..PI, 0 = 3 o'clock

      // pointer wedge: aimed at 12 o'clock (angle = -PI/2), from ring edge
      // out to pointerTip, tapering to a point.
      const pointerAngle = -Math.PI / 2;
      let da = angle - pointerAngle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      if (dist >= ringInner && dist <= pointerTip) {
        const t = Math.max(0, (dist - ringInner) / (pointerTip - ringInner));
        const halfAngleAtT = 0.34 * (1 - t); // taper to a point at the tip
        if (Math.abs(da) <= halfAngleAtT) {
          setPx(buf, hi, x, y, GREEN);
          continue;
        }
      }

      // outer ring
      if (dist <= R && dist >= ringInner) {
        setPx(buf, hi, x, y, GOLD);
        continue;
      }

      // spokes (cream), between hub and inner ring edge
      if (dist < ringInner && dist > hubR) {
        for (let s = 0; s < spokeCount; s++) {
          const spokeAngle = (2 * Math.PI * s) / spokeCount;
          let sda = angle - spokeAngle;
          while (sda > Math.PI) sda -= 2 * Math.PI;
          while (sda < -Math.PI) sda += 2 * Math.PI;
          if (Math.abs(sda) <= spokeHalfAngle) {
            setPx(buf, hi, x, y, CREAM);
            break;
          }
        }
      }

      // hub
      if (dist <= hubR) {
        setPx(buf, hi, x, y, GREEN);
      }
    }
  }

  return downsample(buf, hi, SS);
}

function writePNG(name, size, rgba) {
  const png = encodePNG(size, size, rgba);
  writeFileSync(path.join(OUT, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}

// --- standard icons: mark reaches toward the edge ----------------------
for (const size of [192, 512]) {
  const rgba = drawMark(size, { markRadiusFrac: 0.62, pointerTipFrac: 0.98 });
  writePNG(`icon-${size}.png`, size, rgba);
}

// --- maskable icons: mark held inside the ~80% safe zone (radius 0.4) --
for (const size of [192, 512]) {
  const rgba = drawMark(size, { markRadiusFrac: 0.34, pointerTipFrac: 0.4 });
  writePNG(`icon-maskable-${size}.png`, size, rgba);
}

// --- apple touch icon: iOS applies its own rounding, not a hard crop,
// but a small inset keeps the pointer clear of the corner curvature ----
{
  const size = 180;
  const rgba = drawMark(size, { markRadiusFrac: 0.5, pointerTipFrac: 0.82 });
  writePNG("apple-touch-icon.png", size, rgba);
}

// --- favicon: 32x32 PNG embedded in an ICO container --------------------
{
  const size = 32;
  const rgba = drawMark(size, { markRadiusFrac: 0.62, pointerTipFrac: 0.98 });
  const png = encodePNG(size, size, rgba);

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = size; // width
  entry[1] = size; // height
  entry[2] = 0; // color count
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(png.length, 8); // bytes in resource
  entry.writeUInt32LE(6 + 16, 12); // offset

  const ico = Buffer.concat([dir, entry, png]);
  writeFileSync(path.join(OUT, "favicon.ico"), ico);
  console.log(`wrote favicon.ico (${size}x${size}, ${ico.length} bytes)`);
}

// --- og-image: 1200x630 social preview card -----------------------------
{
  const width = 1200;
  const height = 630;
  const SS = 2;
  const hi = { w: width * SS, h: height * SS };
  const buf = Buffer.alloc(hi.w * hi.h * 4);
  for (let y = 0; y < hi.h; y++) {
    for (let x = 0; x < hi.w; x++) setPx(buf, hi.w, x, y, INK);
  }
  // draw the mark centered in the left third, plus a gold accent rule
  // beneath the (absent) wordmark area — kept text-free since we have no
  // font rasterizer available; strings.ts/index.html carry the real title.
  const markSize = 420 * SS;
  const mark = drawMark(markSize / SS, { markRadiusFrac: 0.62, pointerTipFrac: 0.98 });
  const markSizeActual = markSize / SS;
  const offsetX = Math.round(140 * SS);
  const offsetY = Math.round((hi.h - markSize) / 2);
  for (let y = 0; y < markSizeActual; y++) {
    for (let x = 0; x < markSizeActual; x++) {
      const si = (y * markSizeActual + x) * 4;
      const dx = offsetX + x * SS;
      const dy = offsetY + y * SS;
      // nearest-neighbor upscale by SS since `mark` is already size/SS res
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          setPx(buf, hi.w, dx + sx, dy + sy, [mark[si], mark[si + 1], mark[si + 2], mark[si + 3]]);
        }
      }
    }
  }
  // gold accent rule to the right of the mark, brand flavor without text
  const ruleY0 = Math.round(hi.h * 0.55);
  const ruleY1 = ruleY0 + 6 * SS;
  const ruleX0 = offsetX + markSize + 60 * SS;
  const ruleX1 = hi.w - 100 * SS;
  for (let y = ruleY0; y < ruleY1; y++) {
    for (let x = ruleX0; x < ruleX1; x++) setPx(buf, hi.w, x, y, GOLD);
  }

  // downsample() assumes a square canvas; og-image is 1200x630, so
  // downsample the rectangular hi-res buffer inline instead.
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const n = SS * SS;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * hi.w + (x * SS + dx)) * 4;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3];
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  const png = encodePNG(width, height, out);
  writeFileSync(path.join(OUT, "og-image.png"), png);
  console.log(`wrote og-image.png (${width}x${height}, ${png.length} bytes)`);
}
