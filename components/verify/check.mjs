#!/usr/bin/env node
// Deckadence static gates — Tier 0 of references/pitfalls.md. No browser, no deps.
//   node components/verify/check.mjs deck/index.html
// Run after EVERY edit. Exits nonzero on any failure, so it can gate a commit.
//
// Checks: station parse · monotone staircase · duplicate ids · engine syntax ·
//         scenes used vs registered · data-fly values vs handled · unstyled classes.
// It cannot check layout OVERFLOW — that needs a screenshot (components/verify/shoot.sh).

import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'deck/index.html';
// Strip HTML comments FIRST. Prose inside a comment ("change the <script src> below") is not
// markup, and scanning it produces phantom scripts, ids and stations.
const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
let fail = 0;
const bad = (...m) => { fail++; console.log('FAIL', ...m); };
const ok = (...m) => console.log('  ok', ...m);

/* ---------- views: MARKUP vs SCRIPT ----------
 * A spliced component documents its own markup in a JS comment, so scanning the whole file
 * for stations invents phantom ones. Scan markup on a script-free view. */
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '<script></script>');
const js = scripts.join('\n');

/* ---------- stations ---------- */
const tags = [...markup.matchAll(/<section\b[^>]*\bclass="[^"]*\bstation\b[^"]*"[^>]*>/g)].map(m => m[0]);
const attr = (tag, n) => { const a = tag.match(new RegExp(`\\b${n}="([^"]*)"`)); return a ? a[1] : null; };
const stations = tags.map(t => ({
  tag: t, id: attr(t, 'id'), name: attr(t, 'data-name'),
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
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
dups.length ? bad('duplicate ids:', dups.join(', ')) : ok('no duplicate ids');

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

/* ---------- data-fly values the engine actually handles ---------- */
// A fly the engine does not know silently degrades to the default pan; a fly that forgets to
// dispatch the reveal leaves the station arriving dead (pitfalls trap 13).
const flies = [...new Set(stations.map(s => s.fly).filter(Boolean))];
for (const f of flies) {
  if (!new RegExp(`dataset\\.fly\\s*===\\s*['"]${f}['"]`).test(js)) bad(`data-fly="${f}" is never handled in the engine`);
}
if (flies.length && !fail) ok(`flies handled (${flies.join(', ')})`);

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

console.log(fail ? `\n${fail} FAILURE(S)` : '\nstatic gates PASS (layout still needs eyes: components/verify/shoot.sh)');
process.exit(fail ? 1 : 0);
