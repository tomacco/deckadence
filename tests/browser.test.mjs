// Real-browser tests (headless Chrome). Skipped when no Chrome is found, unless
// REQUIRE_BROWSER=1 (CI sets it), in which case a missing browser is a failure.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, TEMPLATE, LANDING, scratchDeck, once, read, runAsync, findChrome } from './helpers.mjs';
import { pack } from '../components/stream/pack.mjs';
import { loaderFor } from '../components/runtime/runtime.mjs';

const chrome = findChrome();
if (!chrome && process.env.REQUIRE_BROWSER) throw new Error('REQUIRE_BROWSER is set but no Chrome was found');
const skip = !chrome && 'no Chrome/Chromium found (set DECK_BROWSER)';
const unprimed = s => once(s, '    primeStation(s);\n    const reveal', '    const reveal');
const flash = file => runAsync(process.execPath, [join(ROOT, 'components/verify/flash.mjs'), file],
  { timeout: 240_000, env: { DECK_BROWSER: chrome } });

describe('final-state flash (pitfalls.md trap 2)', { concurrency: true, skip }, () => {
  test('the template never flashes', async () => {
    const r = await flash(scratchDeck(TEMPLATE));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no flashes/);
  });

  test('the landing never flashes', async () => {
    const r = await flash(LANDING);
    assert.equal(r.code, 0, r.out);
  });

  // THE regression test: put the original bug back and the probe must catch it.
  test('the probe catches the bug when goto() stops priming', async () => {
    const r = await flash(scratchDeck(TEMPLATE, undefined, { js: unprimed }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL fwd  → LYRA/);
    assert.match(r.out, /revealed without priming/);
  });

  // The landing runs the SHARED runtime: the same bug put back in deckadence.js alone, with the landing's
  // own file untouched, reaches it. A fix travels the same way.
  test('the landing runs the shared runtime: a bug in deckadence.js alone reaches it', async () => {
    const r = await flash(scratchDeck(LANDING, undefined, { js: unprimed }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /revealed without priming/);
  });
});

// The page's DOM after its scripts ran, read from a file:// URL. A managed Chrome may linger after it has
// printed the DOM, so it is stopped as soon as the document is out.
function dumpDom(file, profile, suffix = '') {
  return new Promise(done => {
    let out = '';
    const p = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
      '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(file).href + suffix], { stdio: ['ignore', 'pipe', 'ignore'] });
    const guard = setTimeout(() => p.kill(), 90_000);
    p.stdout.on('data', d => { out += d; if (/<\/html>\s*$/.test(out)) p.kill(); });
    p.on('exit', () => { clearTimeout(guard); done(out); });
  });
}

// D3: the single-file export presents from file://, alone, with no folder beside it and no server.
describe('single-file export', { skip }, () => {
  test('presents from file://: the engine boots and mounts the start station', async () => {
    const src = scratchDeck(TEMPLATE, s => s.replace('https://cdn.jsdelivr.net/npm/animejs@4.4.1/dist/bundles/anime.umd.min.js', 'vendor/anime.umd.min.js'));
    const dir = mkdtempSync(join(tmpdir(), 'deck-file-')), alone = join(dir, 'talk.html');
    writeFileSync(alone, pack(read(src), { load: loaderFor(src) }).html);
    const dom = await dumpDom(alone, join(dir, 'profile'));
    assert.match(dom, /<body[^>]*class="[^"]*\bdeck-ready\b/, dom.slice(0, 2000));
    assert.match(dom, /<section class="station" id="s1"[^>]*>\s*<div class="eyebrow"/);   // mounted, not a <template>
    assert.match(dom, /class="lineInner"/);                                                  // and its heading split
  });
});

// The hooks a deck's own script gets instead of splicing into the engine: a scene's handleKey sees each step
// first (true consumes it), and deck:arrive / deck:leave bubble from the station.
describe('runtime hooks', { skip }, () => {
  test('handleKey consumes a step, then lets the deck move on; arrive and leave fire in order', async () => {
    const probe = `<script>
  const log = [], B = document.body;
  document.addEventListener('deck:arrive', e => { log.push('arrive ' + e.detail.key); B.dataset.log = log.join(','); });
  document.addEventListener('deck:leave', e => { log.push('leave ' + e.detail.key); B.dataset.log = log.join(','); });
  let beats = 1;
  Deckadence.scenes.diagram.handleKey = dir => beats-- > 0 && (log.push('beat'), true);
  document.addEventListener('deck:arrive', e => { if (e.detail.key === 'RIGEL') setTimeout(() => { Deckadence.step(1); Deckadence.step(1); }, 200); });
</script>
</body>`;
    const deck = scratchDeck(TEMPLATE, s => s.replace('https://cdn.jsdelivr.net/npm/animejs@4.4.1/dist/bundles/anime.umd.min.js', 'vendor/anime.umd.min.js')
      .replace('</body>', probe));
    // ?still=1: every fly lands in the same tick, so the log does not depend on how fast the flight runs
    const dom = await dumpDom(deck, join(mkdtempSync(join(tmpdir(), 'deck-hooks-')), 'profile'), '?still=1#RIGEL');
    assert.match(dom, /data-log="arrive RIGEL,beat,leave RIGEL,arrive ALTAIR"/, dom.slice(0, 1500));
  });
});
