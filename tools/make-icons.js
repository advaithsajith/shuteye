/*
 * Draws the ShutEye icon (the sleeping fox under a night sky) at every size the
 * extension and the iOS app need. No dependencies:  node tools/make-icons.js
 *
 * The fox's shape comes from extension/shared.js, so it always matches the popup.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

globalThis.chrome = { storage: {} };
require('../extension/shared.js');
const FOX = globalThis.ShutEye.FOX;

const OUT = path.join(__dirname, '..', 'extension', 'images');
const SIZES = [48, 64, 96, 128, 256, 512, 1024];

const FUR_TOP = [255, 176, 92], FUR_LOW = [240, 112, 48];
const EAR = [150, 62, 34], CREAM = [255, 240, 220], INK = [24, 17, 40];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distToSeg(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp01(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function nearLine(x, y, line, half) {
  for (let i = 0; i < line.length - 1; i++) if (distToSeg(x, y, line[i], line[i + 1]) <= half) return true;
  return false;
}
// closed eyes are curves: turn each into a short run of straight pieces
const LIDS = FOX.lids.map(([a, c, b]) => {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
});

// The fox sits a little below centre, filling about 70% of the icon.
const SCALE = 0.70 / FOX.box[2];
const CX = FOX.box[0] + FOX.box[2] / 2 - 1.5, CY = FOX.box[1] + FOX.box[3] / 2 + 1;

const STARS = [[0.13, 0.16, 0.011], [0.27, 0.07, 0.007], [0.9, 0.42, 0.008], [0.08, 0.5, 0.006], [0.62, 0.09, 0.009], [0.93, 0.8, 0.007], [0.1, 0.86, 0.008]];

// Colour of the icon at (u, v), both 0..1.
function shade(u, v) {
  // night sky with a soft glow behind the fox
  const d = Math.hypot(u - 0.5, v - 0.56);
  let c = mix([52, 36, 92], [10, 9, 22], clamp01(d / 0.82));
  for (const [sx, sy, r] of STARS) {
    const s = Math.hypot(u - sx, v - sy);
    c = c.map((val, i) => val + [255, 244, 226][i] * (Math.exp(-(s * s) / (r * r)) * 0.9));
  }

  const x = (u - 0.5) / SCALE + CX, y = (v - 0.54) / SCALE + CY;
  if (inPoly(x, y, FOX.head)) {
    c = mix(FUR_TOP, FUR_LOW, clamp01((y - 5) / 36));
    if (FOX.ears.some((e) => inPoly(x, y, e))) c = EAR;
    if (FOX.cheeks.some((k) => inPoly(x, y, k))) c = CREAM;
    if (Math.hypot(x - FOX.nose[0], y - FOX.nose[1]) <= FOX.nose[2]) c = INK;
    if (LIDS.some((l) => nearLine(x, y, l, 0.95))) c = INK;
  }
  if (FOX.zs.some((z) => nearLine(x, y, z, 0.8))) c = CREAM;
  return c.map((val) => Math.max(0, Math.min(255, val)));
}

function render(size) {
  const ss = size <= 128 ? 4 : 3;                    // supersampling keeps edges smooth
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;                                    // PNG filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss, o = row + 1 + x * 4;
      raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n); raw[o + 3] = 255;
    }
  }
  return raw;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
function png(size, raw) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6;                          // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, 'icon-' + size + '.png');
  fs.writeFileSync(file, png(size, render(size)));
  console.log('wrote', path.relative(process.cwd(), file));
}
