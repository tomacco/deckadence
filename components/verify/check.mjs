#!/usr/bin/env node
// Deckadence static gates — Tier 0 of references/pitfalls.md. No browser, no deps.
//   node components/verify/check.mjs deck/index.html
// Run after EVERY edit. Exits nonzero on any failure, so it can gate a commit.
//
// Checks: station parse · monotone staircase · duplicate ids · station keys (data-key) ·
//         engine syntax · scenes used vs registered · data-fly values vs handled · device
//         chrome (full screen, swipe, mask, culling, rail window, phone CSS) · flash guard
//         (primeStation in goto, prep(el) on every scene) · CSS scoped
//         to a positional #sN id · [data-key] selectors naming no station · unstyled classes.
// FAIL lines gate (exit 1); WARN lines are reported and do not.
// It cannot check layout OVERFLOW — that needs a screenshot (components/verify/shoot.sh).

import { readFileSync } from 'node:fs';
import { inRuntime, inlineLocal, loaderFor, majorOf, pinOf, versionOf } from '../runtime/runtime.mjs';

const file = process.argv[2] || 'deck/index.html';
// The shared runtime (deckadence/) is read as if it were inline: every gate below checks the engine
// the deck actually runs, wherever it lives.
const raw = readFileSync(file, 'utf8'), rt = inlineLocal(raw, loaderFor(file), { only: inRuntime });
// Strip HTML comments FIRST. Prose inside a comment ("change the <script src> below") is not
// markup, and scanning it produces phantom scripts, ids and stations.
const html = rt.html.replace(/<!--[\s\S]*?-->/g, '');
let fail = 0, warned = 0;
const bad = (...m) => { fail++; console.log('FAIL', ...m); };
const warn = (...m) => { warned++; console.log('WARN', ...m); };   // reported, never gates
const ok = (...m) => console.log('  ok', ...m);

/* ---------- views: MARKUP vs SCRIPT ----------
 * A spliced component documents its own markup in a JS comment, so scanning the whole file
 * for stations invents phantom ones. Scan markup on a script-free view. */
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '<script></script>');
const js = scripts.join('\n');

/* ---------- stations ---------- */
// Attribute values may be "double" or 'single' quoted; both are valid HTML.
const STATION_TAG = /<section\b[^>]*\bclass=(?:"[^"]*\bstation\b[^"]*"|'[^']*\bstation\b[^']*')[^>]*>/g;
const tags = [...markup.matchAll(STATION_TAG)].map(m => m[0]);
const attr = (tag, n) => {
  const a = tag.match(new RegExp(`(?:^|\\s)${n}=(?:"([^"]*)"|'([^']*)')`));
  return a ? (a[1] ?? a[2]) : null;
};
const stations = tags.map(t => ({
  tag: t, id: attr(t, 'id'), name: attr(t, 'data-name'), key: attr(t, 'data-key'),
  x: Number(attr(t, 'data-x')), y: Number(attr(t, 'data-y')),
  scene: attr(t, 'data-scene'), fly: attr(t, 'data-fly'),
}));

// A station the regex cannot parse must never silently pass.
if (!stations.length) bad('parsed 0 stations — is the class/attribute markup intact?');
else ok(stations.length, 'stations parsed');
for (const s of stations) {
  if (!s.id) bad('a station has no id (deep links and screenshots address stations BY ID)');
  if (Number.isNaN(s.x) || Number.isNaN(s.y)) bad(`station ${s.id}: missing/invalid data-x|data-y`);
}

/* ---------- monotone down/right staircase ---------- */
let stair = true;
for (let i = 1; i < stations.length; i++) {
  const dx = stations[i].x - stations[i - 1].x, dy = stations[i].y - stations[i - 1].y;
  if (!((dx > 0 && dy === 0) || (dy > 0 && dx === 0))) {
    stair = false;
    bad(`staircase ${stations[i - 1].id} -> ${stations[i].id}: dx=${dx} dy=${dy}`,
        '(each step must be pure RIGHT or pure DOWN)');
  }
}
if (stair && stations.length > 1) ok('staircase monotone');

/* ---------- duplicate ids (whole document) ---------- */
const ids = [...markup.matchAll(/\sid=(?:"([^"]+)"|'([^']+)')/g)].map(m => m[1] ?? m[2]);
const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
dups.length ? bad('duplicate ids:', dups.join(', ')) : ok('no duplicate ids');

/* ---------- station keys: the STABLE name (ids are positional) ----------
 * `id="sN"` is renumbered on every reorder; `data-key` is not, so it is what the HUD shows,
 * what `#KEY` deep-links to, and what CSS scopes by. The engine matches keys
 * case-insensitively and tries ids FIRST, so a key that reads like an id is ambiguous. */
const keyFail0 = fail;
const keyless = stations.filter(s => !s.key);
if (keyless.length) warn(`${keyless.length} station(s) have no data-key:`, keyless.map(s => s.id).join(', '),
  '(numbers move on reorder; give each station a stable key to say out loud in review)');
const keyed = stations.filter(s => s.key);
const seenKeys = new Map();
for (const s of keyed) {
  const K = s.key.toUpperCase();
  if (seenKeys.has(K)) bad(`duplicate data-key "${s.key}": ${seenKeys.get(K).id} and ${s.id}`,
    '(a changed slide gets a NEW key; retired keys are never reused)');
  else seenKeys.set(K, s);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.~-]*$/.test(s.key))
    bad(`station ${s.id}: data-key "${s.key}" is not a clean hash fragment`,
        '(letters, digits, - _ . ~ only, starting with a letter or digit — it must work as #KEY)');
  if (/^s\d+$/i.test(s.key))
    bad(`station ${s.id}: data-key "${s.key}" looks like a positional sN id`,
        '(#' + s.key + ' would mean a POSITION, not this slide — pick a name from your vocabulary)');
  else if (stations.some(o => o.id && o.id.toUpperCase() === K))
    bad(`station ${s.id}: data-key "${s.key}" collides with a station id (#${s.key} is ambiguous)`);
}
if (keyed.length && !keyless.length && fail === keyFail0) ok(`every station keyed, keys unique and linkable (${keyed.length})`);

/* ---------- shared runtime: present, and the major the deck is pinned to ---------- */
for (const p of rt.missing) bad(`runtime: ${p} is missing beside the deck (node components/runtime/install.mjs ${file})`);
{
  const v = versionOf(js), pin = pinOf(raw);
  if (v && pin !== majorOf(v)) bad(`runtime: the deck is pinned to ${pin ? 'runtime ' + pin : 'no runtime (no <html data-deckadence>)'} but runs ${v}`,
    '(install the runtime its pin names, or port the deck and run install.mjs --major)');
  else if (v) ok(`runtime ${v}, pinned to ${pin}` + (rt.inlined.length ? ` (${rt.inlined.join(', ')})` : ' (inline)'));
}

/* ---------- engine syntax ---------- */
scripts.forEach((src, i) => {
  try { new Function(src); ok(`inline script ${i + 1} compiles`); }        // compiles, never runs
  catch (e) { bad(`inline script ${i + 1} SYNTAX: ${e.message}`); }
});
if (!scripts.length) bad('no inline <script> found — the engine is missing');

/* ---------- scenes used vs registered ---------- */
const used = [...new Set(stations.map(s => s.scene).filter(Boolean))];
const registered = [...new Set([
  ...[...js.matchAll(/sceneRegistry\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
  ...[...js.matchAll(/sceneRegistry\[['"]([^'"]+)['"]\]\s*=/g)].map(m => m[1]),
])];
for (const u of used) if (!registered.includes(u)) bad(`data-scene="${u}" is not registered`);
for (const r of registered) if (!used.includes(r)) console.log('  note: scene', r, 'registered but unused');
if (used.length && used.every(u => registered.includes(u))) ok(`scenes wired (${used.join(', ')})`);

/* ---------- flash guard: PRIME at departure, PLAY on arrival (pitfalls.md trap 2) ----------
 * The camera shows the destination DURING the flight. If its initial (hidden) state is applied
 * on arrival, the audience sees it finished, then empty, then animating back in. The engine
 * primes every station at departure (primeStation, called from goto) and a scene primes
 * through prep(el). Both are checked here; components/verify/flash.mjs checks it for real. */
const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const code = noComments(js);
const gotoBody = (code.match(/function goto\s*\([^)]*\)\s*\{([\s\S]*?)\n {0,4}\}/) || [])[1] || '';
if (!/function primeStation\s*\(/.test(code))
  bad('flash guard: no primeStation() in the engine — every station is hidden on arrival and FLASHES (pitfalls.md trap 2; rebuild from the current template)');
else if (!/primeStation\s*\(/.test(gotoBody))
  bad('flash guard: goto() never calls primeStation() — the flight shows the finished station, then arrival hides it (trap 2)');
else ok('flash guard: goto() primes the destination before it flies');
{
  const regs = [...code.matchAll(/sceneRegistry(?:\.([A-Za-z_$][\w$]*)|\[['"]([^'"]+)['"]\])\s*=(?!=)/g)];
  const noPrep = regs.filter((m, i) => {
    const seg = code.slice(m.index, i + 1 < regs.length ? regs[i + 1].index : m.index + 6000);
    return !/\bprep\s*(\(|:)/.test(seg);
  }).map(m => m[1] || m[2]);
  for (const n of noPrep) bad(`flash guard: scene "${n}" has no prep(el) — its initial state is set on arrival, so it FLASHES. Move every reset out of run() into prep(el) (trap 2)`);
  if (regs.length && !noPrep.length) ok(`flash guard: every scene has prep(el) (${regs.length})`);
}

/* ---------- data-fly values the engine actually handles ---------- */
// A fly the engine does not know silently degrades to the default pan; a fly that forgets to
// dispatch the reveal leaves the station arriving dead (pitfalls trap 13).
const flies = [...new Set(stations.map(s => s.fly).filter(Boolean))];
for (const f of flies) {
  if (!new RegExp(`dataset\\.fly\\s*===\\s*['"]${f}['"]`).test(js)) bad(`data-fly="${f}" is never handled in the engine`);
}
if (flies.length && !fail) ok(`flies handled (${flies.join(', ')})`);

/* ---------- device chrome: phone + iPad scaffolding is an INVARIANT ----------
 * The template ships full screen, swipe nav, the letterbox mask, station culling, the rail
 * window and phone-size HUD rules. A builder that rewrites the HUD or engine tends to drop
 * them silently; a deck without them still looks fine on the builder's desktop. Gate them. */
const chrome = [
  ['viewport-fit=cover',          () => /viewport-fit=cover/.test(markup),                 'meta viewport lacks viewport-fit=cover (safe-area insets are dead)'],
  ['#fsbtn',                      () => /\bid="fsbtn"/.test(markup),                        'no #fsbtn — the full-screen toggle button is gone'],
  ['#rotatehint',                 () => /\bid="rotatehint"/.test(markup),                   'no #rotatehint — portrait phones get an unreadable 16:9 frame'],
  ['F key',                       () => /e\.key\s*===\s*['"]f['"]/.test(js),               'F does not toggle full screen'],
  ['swipe nav',                   () => /addEventListener\(\s*['"]touchend['"]/.test(js),   'no touchend listener — swipes do nothing'],
  ['letterbox mask',              () => /clipPath/.test(js),                               'no clip-path mask — neighbouring stations leak into the letterbox bars'],
  ['station culling',             () => /pointer:\s*coarse/.test(js) && /visibility/.test(js), 'no touch culling — mobile Safari will kill the tab on long decks'],
  ['rail window',                 () => /railWindow\s*\(/.test(js),                        'no railWindow — the dots overflow the HUD past ~25 stations'],
  ['(pointer: coarse) CSS',       () => /@media[^{]*pointer:\s*coarse/.test(markup),       'no (pointer: coarse) media query — touch chrome never adapts'],
  ['phone-size CSS',              () => /@media[^{]*max-width:\s*7\d\dpx/.test(markup),    'no phone-size media query — HUD does not fit a phone'],
];
const missing = chrome.filter(([, test]) => !test());
missing.forEach(([, , why]) => bad('device chrome:', why));
if (!missing.length) ok('device chrome intact (full screen, swipe, mask, culling, rail window, phone CSS)');

/* ---------- live window: memory stays flat as the deck grows ----------
   An engine without it keeps every station laid out, painted and decoded (pitfalls.md trap 22).
   An engine WITH it must also keep the plane from painting before it runs, or the browser decodes
   every image while it is still parsing and the window saves nothing at load. Old engines only
   get a WARN: they still work, they just do not scale. */
if (!/function mountStation\s*\(/.test(js))
  warn('live window: this engine keeps every station in memory (no mountStation) — long decks get slow and phones reload the tab; rebuild from the current template');
else if (!/body:not\(\.deck-ready\)\s*#world\s*\{[^}]*visibility:\s*hidden/.test(markup) || !/classList\.add\(\s*['"]deck-ready['"]\s*\)/.test(js))
  bad('live window: the plane can paint before the engine runs (no body:not(.deck-ready) #world gate) — every image in the deck decodes at load (trap 22)');
else ok('live window: far stations leave the DOM, nothing paints before the engine');

/* ---------- control-layer hooks (edit mode) ----------
 * Not a failure: a deck without window.Deckadence still presents. It just cannot be edited
 * in the browser (components/edit/, references/edit.md). */
if (/window\.Deckadence\s*=/.test(js)) ok('edit-mode hooks present (window.Deckadence)');
else console.log('  note: no window.Deckadence — edit mode (components/edit/serve.mjs) cannot drive this deck');

/* ---------- CSS scoped to a station's POSITIONAL id ----------
 * `#s4 .bar {…}` breaks on reorder in two directions: the id moves away and the rule styles
 * nothing, or ANOTHER station inherits the number and the rule styles the wrong slide
 * (measured: 24 rules from one station landing on its neighbour, read as an overflow bug).
 * Any station-id scope is a WARN; a scope whose classes only exist inside a DIFFERENT
 * station's markup is the inverted case, and FAILS. Scope by [data-key="…"] instead. */
const stationBody = [];            // each station's own markup, <section …> to its </section>
for (const m of markup.matchAll(STATION_TAG)) {
  const re = /<(\/?)section\b[^>]*>/g; re.lastIndex = m.index + m[0].length;
  let depth = 1, end = markup.length, t;
  while ((t = re.exec(markup))) { depth += t[1] ? -1 : 1; if (!depth) { end = t.index; break; } }
  stationBody.push(markup.slice(m.index, end));
}
const classesIn = src => new Set([...src.matchAll(/\sclass=(?:"([^"]+)"|'([^']+)')/g)]
  .flatMap(m => (m[1] ?? m[2]).split(/\s+/).filter(Boolean)));
const stationClasses = stationBody.map(classesIn);
const stationAt = new Map(stations.map((s, i) => [s.id, i]));
const who = s => s.key ? `${s.id} (${s.key})` : s.id;
// Statement at-rules (@import url(x); @charset "…"; @layer a, b;) have no block: stripped, or
// they would glue onto the NEXT rule's prelude, which then starts with "@" and is skipped.
const css = [...markup.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/@[^{};]*;/g, '');
// Split a selector list on TOP-LEVEL commas only: `:is(#s1, #s2) .x` is ONE selector.
function splitSelectors(prelude) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of prelude) {
    if (q) { if (ch === q) q = null; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && !depth) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}
const idScoped = new Map();        // id -> [selectors]
const crossed = new Set();
const keySels = [];                // [data-key="X"] values used in CSS: [value, selector, i-flag]
for (const m of css.matchAll(/([^{}]+)\{/g)) {                 // rule preludes, @media bodies too
  const prelude = m[1].trim();
  if (!prelude || prelude.startsWith('@')) continue;
  for (const sel of splitSelectors(prelude)) {
    for (const [, v1, v2, v3, flag] of sel.matchAll(/\[\s*data-key\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([iIsS])?\s*\]/g))
      keySels.push([v1 ?? v2 ?? v3, sel, /i/i.test(flag || '')]);
    // Ids and classes are read with attribute selectors blanked: `a[href="#s2"]` is no id scope.
    const bare = sel.replace(/\[(?:[^\]"']|"[^"]*"|'[^']*')*\]/g, '[]');
    const scopedIds = [...bare.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)].map(x => x[1])
      .filter(id => stationAt.has(id) || /^s\d+$/.test(id));    // chrome (#hud, #rail, …) is fine
    for (const id of scopedIds) {
      if (!idScoped.has(id)) idScoped.set(id, []);
      idScoped.get(id).push(sel);
    }
    // Cross-station check only when the selector names exactly ONE station: `:is(#s1, #s2)`
    // legitimately reaches classes in either, and is reported by the WARN below.
    const i = scopedIds.length === 1 ? stationAt.get(scopedIds[0]) : undefined;
    if (i === undefined) continue;                              // none, several, or dangling
    for (const [, c] of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (stationClasses[i].has(c)) continue;                   // the station's own markup
      const owners = stations.filter((o, k) => k !== i && stationClasses[k].has(c));
      const msg = `CSS "${sel}" is scoped to #${scopedIds[0]} = ${who(stations[i])}, but .${c} is not in this ` +
        `station's markup; it appears only in ${owners.map(who).join(', ')} — the rule is dead here or ` +
        'leaking onto the wrong station (a reorder moved the id)';
      if (owners.length && !crossed.has(msg)) { crossed.add(msg); bad(msg); }
    }
  }
}
for (const [id, sels] of idScoped) {
  const i = stationAt.get(id), eg = `"${sels[0]}"` + (sels.length > 1 ? ` +${sels.length - 1} more` : '');
  if (i === undefined) warn(`${sels.length} CSS rule(s) scoped to #${id}, which is no station — they style nothing (${eg})`);
  else warn(`${sels.length} CSS rule(s) scoped to station id #${id} (${eg}); ids are positional and move on reorder —`,
    `scope by [data-key="${stations[i].key || 'KEY'}"] or a class the station carries`);
}
if (!idScoped.size) ok('no CSS scoped to a positional station id');

/* ---------- CSS scoped to a key no station has ----------
 * Re-keying a station (the naming rule: a different slide gets a NEW key) silently orphans
 * every `[data-key="OLD"]` rule — the #sN bug again, one step later. FAIL, not WARN: unlike
 * an id scope, a key selector has no legitimate reason to name a key no station carries (a
 * reserved key has no markup to style yet). CSS attribute matching is CASE-SENSITIVE while
 * deep links are not, so `[data-key="lyra"]` against data-key="LYRA" fails too (unless the
 * selector carries the `i` flag). */
const keySet = new Set(stations.map(s => s.key).filter(Boolean));
const keyUpper = new Map(stations.filter(s => s.key).map(s => [s.key.toUpperCase(), s]));
const orphanSeen = new Set();
for (const [v, sel, ci] of keySels) {
  if (keySet.has(v) || orphanSeen.has(sel + '\0' + v)) continue;
  orphanSeen.add(sel + '\0' + v);
  const near = keyUpper.get(v.toUpperCase());
  if (near && ci) continue;
  if (near) bad(`CSS "${sel}" targets data-key "${v}", but the station key is "${near.key}" (${near.id}) —`,
    'CSS attribute matching is case-sensitive, so this rule styles nothing');
  else bad(`CSS "${sel}" targets data-key "${v}", which no station has — it styles nothing`,
    '(re-keyed or retired? move the rule to the new key, or delete it)');
}
if (keySels.length && [...keySels].every(([v, , ci]) => keySet.has(v) || (ci && keyUpper.has(v.toUpperCase()))))
  ok(`every [data-key] selector matches a station (${new Set(keySels.map(k => k[0])).size} keys)`);

/* ---------- classes used but never styled ---------- */
const styled = new Set();
for (const m of markup.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
  for (const c of m[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(c[1]);
const usedClasses = new Set();
for (const m of markup.matchAll(/\bclass="([^"]+)"/g))
  m[1].split(/\s+/).filter(Boolean).forEach(c => usedClasses.add(c));
const unstyled = [...usedClasses].filter(c => !styled.has(c) && !new RegExp(`['"\`]${c}['"\`]|\\b${c}\\b`).test(js));
if (unstyled.length) console.log('  note: classes with no rule and no JS reference:', unstyled.join(', '));
else ok('every class is styled or referenced');

console.log(fail ? `\n${fail} FAILURE(S)` + (warned ? `, ${warned} warning(s)` : '')
  : `\nstatic gates PASS${warned ? ` with ${warned} warning(s)` : ''} (layout still needs eyes: components/verify/shoot.sh)`);
process.exit(fail ? 1 : 0);
