// A HEAVY deck for memory tests: the template's own stations, then N more stations that each hold a
// full-HD photo. One PNG on disk, a distinct ?n= per station, so the browser decodes N separate
// images — the shape of a real generated deck (68 stations, 19 photos, 144 MB of decoded pixels).
// Zero dependencies: the PNG is written with node:zlib.
import { deflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, TEMPLATE, read, copyRuntime } from './helpers.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** An RGB PNG with a gradient and noise, so nothing about it is trivially compressible in memory. */
export function png(w = 1920, h = 1080) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 7;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = seed & 31, o = row + 1 + x * 3;
      raw[o] = (x * 255 / w + n) & 255; raw[o + 1] = (y * 255 / h + n) & 255; raw[o + 2] = (128 + n) & 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Write a deck folder: index.html (template + `extra` photo stations), photo.png, vendor/anime.
 *  `transform` edits the final HTML (e.g. add data-live="all"), `runtime` the engine ({ js, css }, see
 *  copyRuntime). Returns the index.html path. */
export function heavyDeck(extra = 34, transform = s => s, runtime = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deck-heavy-'));
  writeFileSync(join(dir, 'photo.png'), png());
  cpSync(join(ROOT, 'docs/vendor'), join(dir, 'vendor'), { recursive: true });
  copyRuntime(dirname(TEMPLATE), dir, runtime);
  let x = 6900, y = 2900;
  const more = Array.from({ length: extra }, (_, k) => {
    if (k % 2) y += 1450; else x += 2300;                     // monotone staircase: right, down, right, …
    const key = 'P' + String(k + 1).padStart(2, '0');
    return `    <section class="station${k % 3 === 0 ? ' invert' : ''}" id="s${7 + k}" data-key="${key}" data-name="Photo ${k + 1}" data-x="${x}" data-y="${y}">
      <h2 class="display sm" data-split="lines">Photo ${k + 1}</h2>
      <img src="photo.png?n=${k + 1}" alt="" elementtiming="photo-${k + 1}" width="1500" height="844" style="margin-top:30px;object-fit:cover">
    </section>`;
  }).join('\n');
  let html = read(TEMPLATE)
    .replace('https://cdn.jsdelivr.net/npm/animejs@4.4.1/dist/bundles/anime.umd.min.js', 'vendor/anime.umd.min.js')
    .replace(/(<section class="station" id="s6"[\s\S]*?<\/section>)/, `$1\n\n${more}`);
  html = transform(html);
  writeFileSync(join(dir, 'index.html'), html);
  return join(dir, 'index.html');
}
