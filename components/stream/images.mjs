// images.mjs — size a deck's photos for the size the deck shows them at. Zero dependencies.
//
//   used by: node components/stream/pack.mjs deck/index.html --images
//
// WHY   · RAM goes to DECODED pixels: a 2400×1600 photo costs 15 MB in memory whatever its file size, even
//         when the deck shows it in a 900 px box. The live window bounds how many photos are decoded at
//         once; this bounds what each one costs.
// HOW   · Headless Chrome lays the deck out (every station mounted, ?still=1) and reports, per local
//         <img> in a station, its natural size and the box the deck gives it. The width the image needs
//         at a fitted 1920×1080 frame is natural × max(box/natural), so object-fit: cover crops count.
//         Chrome then re-encodes the photo to WebP at 0.5×, 1×, 1.5× and 2× of that width (only the ones
//         smaller than the original) with its own encoder: no codec in this repo, no remote debugging.
//         The packed deck gets srcset + sizes, where sizes is the width the image fills on THIS screen:
//         the frame is fitted, so a box of W station px is min(W/1920·100vw, W/1080·100vh). The browser
//         multiplies by the device pixel ratio and fetches the smallest file that is still sharp: a
//         1080p projector takes 1×, a retina laptop 1.5× or 2×, a phone in portrait 0.5×.
// RULES · The source deck and its photos are never modified; variants go to images/ beside the deck.
//         An <img> that already has srcset, a remote or data: src, an SVG or a GIF is left alone, and so
//         is a photo no larger than the smallest variant it would get.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import * as S from '../edit/source.mjs';

export const DENSITIES = [0.5, 1, 1.5, 2];
const FRAME_W = 1920, FRAME_H = 1080;

/** Variant widths for a photo `natW` wide that the deck shows `needW` wide: every density below 90 % of
 *  the original (above that the original serves). Empty: nothing to gain. */
export const variantWidths = (natW, needW) =>
  [...new Set(DENSITIES.map(d => Math.round(needW * d)))].filter(w => w >= 16 && w < natW * 0.9);

/** The file name of one variant: stable across runs, unique per source path. */
export const variantName = (src, w) =>
  basename(src, extname(src)).replace(/[^A-Za-z0-9_-]/g, '_') + '-' + createHash('sha1').update(src).digest('hex').slice(0, 6) + '-' + w + '.webp';

/** sizes for a photo that needs `needW` px of a fitted 1920×1080 frame. */
export const sizesFor = needW => `min(${+(needW / FRAME_W * 100).toFixed(2)}vw, ${+(needW / FRAME_H * 100).toFixed(2)}vh)`;

const attrRe = n => new RegExp(`(\\s${n}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
const getAttr = (tag, n) => { const m = tag.match(attrRe(n)); return m ? (m[2] ?? m[3] ?? m[4]) : null; };

/**
 * Pure: rewrite every <img> inside a station whose src has a plan entry. `plan` maps src →
 * { needW, natW, variants: [{ file, w }] } (variants ascending). Bytes outside those tags do not change.
 */
export function rewrite(html, plan) {
  let out = html;
  for (const st of [...S.stations(html)].reverse()) {
    const body = S.inner(html, st.el).replace(/<img\b[^>]*>/gi, tag => {
      const src = getAttr(tag, 'src'), p = src && plan[src];
      if (!p || getAttr(tag, 'srcset') != null) return tag;
      const fallback = p.variants.find(v => v.w >= p.needW) || null;
      const srcset = [...p.variants.map(v => `${v.file} ${v.w}w`), `${src} ${p.natW}w`].join(', ');
      return tag.replace(attrRe('src'), (_, pre) => `${pre}"${fallback ? fallback.file : src}"`)
        .replace(/\s*\/?>$/, end => ` srcset="${srcset}" sizes="${sizesFor(p.needW)}"${end}`);
    });
    out = out.slice(0, st.el.openEnd) + body + out.slice(st.el.closeStart);
  }
  return out;
}

// Runs IN THE PAGE (stringified, so it may use nothing from this module): mount everything, measure,
// re-encode, post the results back.
function driver(quality, densities) {
  const post = (p, body) => fetch(p, { method: 'POST', body });
  const local = src => src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && !src.includes('${') && !/\.(svg|gif)(?:[?#]|$)/i.test(src);
  (async () => {
    if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, { once: true }));
    const D = window.Deckadence;
    if (D && D.setLive) await D.setLive('all');
    await document.fonts.ready;
    const imgs = [...document.querySelectorAll('.station img')].filter(i => !i.hasAttribute('srcset'));
    await Promise.all(imgs.map(i => i.decode().catch(() => {})));
    const seen = {};
    for (const img of imgs) {
      const src = img.getAttribute('src'), W = img.naturalWidth, H = img.naturalHeight;
      if (!local(src) || !W || !img.offsetWidth) continue;
      const need = Math.ceil(W * Math.max(img.offsetWidth / W, img.offsetHeight / H));
      if (!seen[src] || seen[src].needW < need) seen[src] = { src, img, natW: W, natH: H, needW: need };
    }
    const plan = {};
    for (const p of Object.values(seen)) {
      const widths = [...new Set(densities.map(d => Math.round(p.needW * d)))].filter(w => w >= 16 && w < p.natW * 0.9);
      if (!widths.length) continue;
      plan[p.src] = { needW: p.needW, natW: p.natW, natH: p.natH, variants: [] };
      for (const w of widths) {
        const h = Math.max(1, Math.round(w * p.natH / p.natW));
        const bmp = await createImageBitmap(p.img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
        const c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
        const blob = await c.convertToBlob({ type: 'image/webp', quality });
        if (blob.type !== 'image/webp') throw new Error('this Chrome cannot encode WebP');
        const r = await post('/__img/put?src=' + encodeURIComponent(p.src) + '&w=' + w, blob);
        plan[p.src].variants.push({ file: await r.text(), w, h, bytes: blob.size });
      }
    }
    await post('/__img/done', JSON.stringify(plan));
  })().catch(e => post('/__img/fail', String(e && e.stack || e)));
}
const DRIVER = (quality, densities) => `<script>(${driver})(${quality}, ${JSON.stringify(densities)});</script>`;

export function findChrome() {
  return [process.env.DECK_BROWSER, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
}

/**
 * Measure and re-encode the photos of the deck at `SRC` (its current text: `html`). Writes the variants
 * to images/ beside the deck and returns the plan for rewrite(). Needs Chrome.
 */
export async function rightSize(SRC, html, { quality = 0.85, timeoutMs = 10 * 60_000 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('--images needs Chrome (set DECK_BROWSER)');
  const DIR = dirname(SRC), PAGE = '/' + basename(SRC), OUT = join(DIR, 'images');
  let plan = null, failure = null;
  const srv = createServer((req, res) => {
    let u; try { u = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); res.end(); return; }
    const p = decodeURIComponent(u.pathname);
    if (req.method === 'POST' && p.startsWith('/__img/')) {
      const chunks = []; req.on('data', d => chunks.push(d)); req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (p === '/__img/put') {
          const name = variantName(u.searchParams.get('src'), +u.searchParams.get('w'));
          mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), body);
          res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('images/' + name); return;
        }
        if (p === '/__img/done') plan = JSON.parse(body.toString('utf8'));
        if (p === '/__img/fail') failure = body.toString('utf8');
        res.writeHead(204); res.end();
      });
      return;
    }
    const file = resolve(join(DIR, p));
    if (!file.startsWith(DIR + sep) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    if (file === resolve(SRC)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html.replace(/<\/body>(?![\s\S]*<\/body>)/i, DRIVER(quality, DENSITIES) + '</body>')); return; }
    createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const profile = mkdtempSync(join(tmpdir(), 'deck-images-'));
  const proc = spawn(chrome, ['--headless=new', '--hide-scrollbars', '--window-size=1920,1080', '--force-device-scale-factor=1',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    `http://127.0.0.1:${srv.address().port}${PAGE}?still=1`], { stdio: 'ignore' });
  const t0 = Date.now();
  while (!plan && !failure && proc.exitCode === null && Date.now() - t0 < timeoutMs) await new Promise(r => setTimeout(r, 200));
  try { proc.kill(); } catch (e) {}
  srv.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  if (failure) throw new Error('right-sizing failed in the page: ' + failure);
  if (!plan) throw new Error('right-sizing did not finish (Chrome ' + (proc.exitCode === null ? 'timed out' : 'exited ' + proc.exitCode) + ')');
  return plan;
}

/** One line per photo: what it was, what the deck needs, what it got. */
export function report(plan) {
  return Object.entries(plan).map(([src, p]) => `  ${src}: ${p.natW}×${p.natH}, shown ${p.needW} px wide → ` +
    p.variants.map(v => `${v.w}w ${(v.bytes / 1024).toFixed(0)} KB`).join(', '));
}
