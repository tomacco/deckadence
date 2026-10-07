// pack --images: photos re-encoded at the sizes the deck shows them, picked per screen through srcset,
// and a station that looks the same afterwards. The browser cases need Chrome (REQUIRE_BROWSER=1 in CI).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, TEMPLATE, read, once, run, check, findChrome, dumpDom, screenshot } from './helpers.mjs';
import { heavyDeck } from './heavy-deck.mjs';
import { rewrite, variantWidths, sizesFor } from '../components/stream/images.mjs';
import { readPng, diff } from '../components/verify/compare.mjs';

const chrome = findChrome();
if (!chrome && process.env.REQUIRE_BROWSER) throw new Error('REQUIRE_BROWSER is set but no Chrome was found');
const skip = !chrome && 'no Chrome/Chromium found (set DECK_BROWSER)';

test('variant widths: every density the original is clearly larger than, none otherwise', () => {
  assert.deepEqual(variantWidths(1920, 1500), [750, 1500]);               // 1.5× and 2× would exceed the original
  assert.deepEqual(variantWidths(2400, 900), [450, 900, 1350, 1800]);
  assert.deepEqual(variantWidths(1672, 1672), [836]);                     // shown full size: only the half-size one
  assert.deepEqual(variantWidths(100, 400), []);                          // smaller than needed: nothing to gain
  assert.equal(sizesFor(1500), 'min(78.13vw, 138.89vh)');                 // the width a 1500 px box fills on a fitted frame
});

test('rewrite touches only <img> tags inside stations that have a plan, and keeps every other byte', () => {
  const html = once(read(TEMPLATE), '      <div class="credits" data-fade>', '      <img src="a.jpg" alt="x">\n      <img src="b.jpg" srcset="b2.jpg 2x">\n      <div class="credits" data-fade>')
    .replace('<body>', '<body>\n<img src="a.jpg" alt="outside">');
  const plan = { 'a.jpg': { needW: 900, natW: 2400, variants: [{ file: 'images/a-1-450.webp', w: 450 }, { file: 'images/a-1-900.webp', w: 900 }] },
                 'b.jpg': { needW: 900, natW: 2400, variants: [{ file: 'images/b-1-450.webp', w: 450 }] } };
  const out = rewrite(html, plan);
  assert.match(out, /<img src="images\/a-1-900\.webp" alt="x" srcset="images\/a-1-450\.webp 450w, images\/a-1-900\.webp 900w, a\.jpg 2400w" sizes="min\(46\.88vw, 83\.33vh\)">/);
  assert.match(out, /<img src="b\.jpg" srcset="b2\.jpg 2x">/);              // the author's own srcset stays
  assert.match(out, /<body>\n<img src="a\.jpg" alt="outside">/);            // not a station: untouched
  const added = out.length - html.length, tag = out.match(/<img src="images\/a-1-900[^>]*>/)[0];
  assert.equal(added, tag.length - '<img src="a.jpg" alt="x">'.length);    // nothing else moved
});

describe('pack --images in a real browser', { skip, concurrency: true }, () => {
  const sized = (() => {
    let made = null;
    return () => made || (made = (async () => {
      const src = heavyDeck(2), dir = dirname(src);
      const r = run(process.execPath, [join(ROOT, 'components/stream/pack.mjs'), src, '--images'], { timeout: 240_000, env: { DECK_BROWSER: chrome } });
      const p = run(process.execPath, [join(ROOT, 'components/stream/pack.mjs'), src, '--out', join(dir, 'plain.html')]);
      return { src, dir, r, p, packed: join(dir, 'index.packed.html'), plain: join(dir, 'plain.html') };
    })());
  })();

  test('writes WebP variants and a deck that passes the gates', async () => {
    const { r, dir, packed } = await sized();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 photo\(s\) right-sized/);
    assert.match(r.out, /1920×1080, shown 1501 px wide → 751w \d+ KB, 1501w \d+ KB/);
    const img = read(packed).match(/<img src="(images\/[^"]+-1501\.webp)"[^>]*srcset="([^"]+)"/);
    assert.ok(img, 'the packed deck points at the variants');
    const webp = readFileSync(join(dir, img[1]));
    assert.equal(webp.toString('ascii', 0, 4) + webp.toString('ascii', 8, 12), 'RIFFWEBP');
    assert.equal(check(packed).code, 0, check(packed).out);
  });

  // Which file a screen fetches: a 1920×1080 screen needs the 1501 px variant, a 960×540 one the 751 px one.
  // The bug put back (no sizes: the browser assumes the image fills the viewport) fetches too much.
  for (const [w, h, expect, mutate] of [[1920, 1080, '1501', null], [960, 540, '751', null], [960, 540, '1501', 'nosizes']]) {
    test(`a ${w}×${h} screen fetches the ${expect} px file${mutate ? ' when sizes is missing (the bug put back)' : ''}`, async () => {
      const { packed } = await sized();
      let file = packed;
      if (mutate) {
        file = packed.replace(/\.html$/, '.nosizes.html');
        writeFileSync(file, read(packed).replace(/ sizes="[^"]*"/g, ''));
      }
      const withProbe = file.replace(/\.html$/, `.probe${w}.html`);
      writeFileSync(withProbe, read(file).replace(/<\/body>(?![\s\S]*<\/body>)/, `<script>
document.addEventListener('deck:arrive', e => { const i = e.target.querySelector('img'); if (i) document.body.dataset.picked = i.currentSrc.split('/').pop(); });
</script></body>`));
      const dom = await dumpDom(chrome, withProbe, join(mkdtempSync(join(tmpdir(), 'deck-pick-')), 'p'), '?still=1#P01', [`--window-size=${w},${h}`, '--force-device-scale-factor=1']);
      const body = (dom.match(/<body[^>]*>/) || ['(no body)'])[0];
      assert.match(body, new RegExp(`data-picked="photo-[0-9a-f]{6}-${expect}\\.webp"`));
    });
  }

  // The acceptance bar: the station looks the same. The test photo is noise on a gradient, the worst case
  // for any resampler; measured 1.5 mean and 0.65 % of pixels moved by more than 32.
  test('a right-sized station matches the original within the stated tolerance (mean ≤ 3, moved ≤ 1 %)', async () => {
    const { packed, plain, dir } = await sized();
    const [a, b] = await Promise.all([screenshot(chrome, plain, join(dir, 'plain.png'), '?still=1#P01'), screenshot(chrome, packed, join(dir, 'sized.png'), '?still=1#P01')]);
    const d = diff(readPng(readFileSync(a)), readPng(readFileSync(b)));
    assert.ok(d.mean <= 3 && d.changed <= 1, JSON.stringify(d));
    const other = await screenshot(chrome, plain, join(dir, 'other.png'), '?still=1#P02');      // and the measure can fail
    const far = diff(readPng(readFileSync(a)), readPng(readFileSync(other)));
    assert.ok(far.mean > 3 || far.changed > 1, JSON.stringify(far));
  });
});
