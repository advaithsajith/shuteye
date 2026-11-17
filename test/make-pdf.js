/* Writes test/sample.pdf: page 1 has text and a small photo, page 2 is one full-page "scan". */
const fs = require('fs');
const path = require('path');

// a small colourful picture (raw RGB)
const W = 64, H = 48;
const photo = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 3;
  photo[o] = Math.round(255 * x / W); photo[o + 1] = Math.round(180 * y / H) + 40; photo[o + 2] = 200 - Math.round(150 * x / W);
}
// a "scanned page": off-white paper with dark rows of "text"
const scan = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 3, ink = y % 4 === 1 && x > 6 && x < W - 6 && (x * 7 + y) % 5 !== 0;
  scan[o] = ink ? 40 : 244; scan[o + 1] = ink ? 40 : 240; scan[o + 2] = ink ? 44 : 228;
}

const text1 = [
  'BT /F1 26 Tf 72 720 Td (ShutEye Reader sample) Tj ET',
  'BT /F1 13 Tf 72 690 Td (Black text on white paper. It should turn into light text on the theme background.) Tj ET',
  'BT /F1 13 Tf 72 670 Td (The picture below is a photo and should keep its real colours.) Tj ET',
  '0.1 0.3 0.8 rg BT /F1 13 Tf 72 650 Td (Blue link-coloured text stays blue.) Tj ET',
  '0 0 0 RG 2 w 72 630 m 540 630 l S',
  'q 240 0 0 180 72 420 cm /Im1 Do Q'
].join('\n');
const text2 = 'q 612 0 0 792 0 0 cm /Im2 Do Q';

const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im2 9 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  { dict: '', data: Buffer.from(text1, 'latin1') },
  { dict: '', data: Buffer.from(text2, 'latin1') },
  { dict: '/Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H + ' /ColorSpace /DeviceRGB /BitsPerComponent 8', data: photo },
  { dict: '/Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H + ' /ColorSpace /DeviceRGB /BitsPerComponent 8', data: scan }
];

const parts = [Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1')];
const offsets = [];
let pos = parts[0].length;
objs.forEach((o, i) => {
  offsets.push(pos);
  const body = typeof o === 'string'
    ? Buffer.from((i + 1) + ' 0 obj\n' + o + '\nendobj\n', 'latin1')
    : Buffer.concat([Buffer.from((i + 1) + ' 0 obj\n<< ' + o.dict + ' /Length ' + o.data.length + ' >>\nstream\n', 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
  parts.push(body);
  pos += body.length;
});
let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
offsets.forEach((o) => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
xref += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + pos + '\n%%EOF\n';
parts.push(Buffer.from(xref, 'latin1'));

const file = path.join(__dirname, 'sample.pdf');
fs.writeFileSync(file, Buffer.concat(parts));
console.log('wrote', file);
