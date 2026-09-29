// Real-browser tests (headless Chrome). Skipped when no Chrome is found, unless
// REQUIRE_BROWSER=1 (CI sets it), in which case a missing browser is a failure.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT, TEMPLATE, LANDING, scratchDeck, once, runAsync, findChrome } from './helpers.mjs';

const chrome = findChrome();
if (!chrome && process.env.REQUIRE_BROWSER) throw new Error('REQUIRE_BROWSER is set but no Chrome was found');
const skip = !chrome && 'no Chrome/Chromium found (set DECK_BROWSER)';
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
    const r = await flash(scratchDeck(TEMPLATE, s => once(s, '    primeStation(s);\n    const reveal', '    const reveal')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL fwd  → LYRA/);
    assert.match(r.out, /revealed without priming/);
  });
});
