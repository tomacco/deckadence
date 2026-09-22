#!/usr/bin/env node
/* motion-check.mjs — static guard for the ARM/PLAY motion invariant.
 *
 * The bug this exists to prevent (shipped twice): a station's from-state was staged only on
 * ARRIVAL, so the audience read the finished slide for the whole camera flight and then watched
 * it reset and rebuild itself. The fix is to ARM at departure and PLAY on arrival. A rule in a
 * doc did not hold; this does.
 *
 * Static on purpose: motion is categorically unverifiable from a headless screenshot, so we
 * assert the STRUCTURE that makes the flash impossible instead of trying to photograph it.
 *
 * Usage: node motion-check.mjs [deck.html ...]   (default: ../../template/starter.html)
 * Exit 0 = invariant holds. Exit 1 = a deck built from this file would flash.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2);
if (!files.length) files.push(resolve(here, '../../template/starter.html'));

// Body of `function name(...) { ... }` by brace matching. Returns '' if not found.
function fnBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) return '';
  let i = m.index + m[0].length, depth = 1;
  const start = i;
  for (; i < src.length && depth; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return src.slice(start, i - 1);
}

// Object literal body for `sceneRegistry.<name> = { ... }`
function sceneBodies(src) {
  const out = [];
  const re = /sceneRegistry\.([A-Za-z0-9_$]+)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1;
    const start = i;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    out.push({ name: m[1], body: src.slice(start, i - 1) });
  }
  return out;
}

let failed = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const errs = [];

  // 1. The two halves of the contract must both exist.
  if (!/function\s+armIntroEl\s*\(/.test(src))
    errs.push('no armIntroEl(el): nothing stages the generic from-state');
  if (!/function\s+armStation\s*\(/.test(src))
    errs.push('no armStation(s): the arm-side twin of revealStation is missing, so nothing arms at departure');
  if (!/function\s+revealStation\s*\(/.test(src))
    errs.push('no revealStation(s): there is no single arrival dispatch point');

  // 2. goto() must ARM before it dispatches the flight, on the new-station path.
  const goto = fnBody(src, 'goto');
  if (!goto) errs.push('no goto(): cannot verify the departure path');
  else {
    const armAt = goto.indexOf('armStation(');
    const flyAt = Math.min(...['flyDive(', 'flyTo('].map(t => {
      const idxs = [];
      let p = -1;
      while ((p = goto.indexOf(t, p + 1)) !== -1) idxs.push(p);
      // the LAST fly call is the new-station dispatch; the earlier one is the replay path
      return idxs.length ? idxs[idxs.length - 1] : Infinity;
    }));
    if (armAt === -1)
      errs.push('goto() never calls armStation(): the destination is staged only on arrival -> FLASH');
    else if (flyAt !== Infinity && armAt > flyAt)
      errs.push('goto() calls armStation() AFTER dispatching the fly: arming must precede departure');
  }

  // 3. The arrival path must be deferred and nav-token guarded, not fired at t=0.
  if (goto && !/done:\s*reveal|\{\s*mid,\s*done:\s*reveal/.test(goto))
    errs.push('goto() does not pass reveal as the fly completion callback (reveal must fire ON ARRIVAL)');
  if (goto && !/fresh\(\)/.test(goto))
    errs.push('goto() has no fresh()/nav-token guard: an interrupted flight can reveal over another station');

  // 4. playIntro must reuse the arm helper rather than restaging inline (drift protection).
  const play = fnBody(src, 'playIntro');
  if (play && !/armIntroEl\(/.test(play))
    errs.push('playIntro() does not call armIntroEl(): the arm and play paths can drift apart');

  // 5. Any scene that animates must expose arm(el), or goto() cannot stage it at departure.
  for (const { name, body } of sceneBodies(src)) {
    if (/(^|\s)run\s*\(/.test(body) && !/(^|\s)arm\s*\(/.test(body))
      errs.push(`scene "${name}" has run() but no arm(): its from-state cannot be staged at departure`);
  }

  if (errs.length) {
    failed++;
    console.error(`FAIL  ${f}`);
    for (const e of errs) console.error(`  - ${e}`);
  } else {
    console.log(`PASS  ${f}  (arm-at-departure / play-on-arrival invariant holds)`);
  }
}
process.exit(failed ? 1 : 0);
