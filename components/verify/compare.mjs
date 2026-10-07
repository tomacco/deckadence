#!/usr/bin/env node
// compare.mjs — how far apart two screenshots are. Zero dependencies (node:zlib reads the PNGs).
//   node components/verify/compare.mjs before.png after.png [--max-mean 3] [--max-changed 1]
// Prints the mean absolute difference per channel (0–255) and the share of pixels where any channel
// moved by more than 32. Exits 1 above either limit, 2 when the images cannot be compared.
// Used to show a change that should not be visible (pack --images) is not.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 8-bit, non-interlaced RGB or RGBA PNG (what Chrome writes) → { w, h, ch, px }. */
export function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let o = 8, w, h, depth, type, interlace; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const ch = { 2: 3, 6: 4 }[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[row - stride + x] : 0, c = x >= ch && y ? px[row - stride + x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, ch, px };
}

/** { mean, changed } between two same-size images: mean |Δ| over RGB, share (%) of pixels with a channel moved > 32. */
export function diff(A, B) {
  if (A.w !== B.w || A.h !== B.h) throw new Error(`sizes differ: ${A.w}×${A.h} vs ${B.w}×${B.h}`);
  let sum = 0, changed = 0;
  for (let i = 0, n = A.w * A.h; i < n; i++) {
    let worst = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(A.px[i * A.ch + c] - B.px[i * B.ch + c]); sum += d; if (d > worst) worst = d; }
    if (worst > 32) changed++;
  }
  const n = A.w * A.h;
  return { mean: +(sum / (n * 3)).toFixed(3), changed: +(changed / n * 100).toFixed(3) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), files = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? +args[i + 1] : d; };
  if (files.length !== 2) { console.error('usage: compare.mjs a.png b.png [--max-mean 3] [--max-changed 1]'); process.exit(2); }
  let r;
  try { r = diff(readPng(readFileSync(files[0])), readPng(readFileSync(files[1]))); } catch (e) { console.error('FAIL ' + e.message); process.exit(2); }
  const maxMean = opt('max-mean', 3), maxChanged = opt('max-changed', 1), ok = r.mean <= maxMean && r.changed <= maxChanged;
  console.log(`${ok ? '  ok' : 'FAIL'} mean |Δ| ${r.mean} (max ${maxMean}) · pixels moved > 32: ${r.changed}% (max ${maxChanged}%)`);
  process.exit(ok ? 0 : 1);
}
