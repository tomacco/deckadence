#!/usr/bin/env node
// install.mjs — put the current runtime into a deck, or check that a deck has it. Zero dependencies.
//
//   node components/runtime/install.mjs deck/index.html            → copies template/deckadence/ to deck/deckadence/
//   node components/runtime/install.mjs deck/index.html --check    → exit 1 when the deck's copy differs
//   node components/runtime/install.mjs deck/index.html --major    → also moves the deck's pin to a new major
//
// A deck pins a MAJOR (<html data-deckadence="2">). Within a major, an install is always safe: that is
// what the major promises, and it is how one engine fix reaches every deck without editing any of them.
// Across majors the deck's markup or scenes may need porting, so install refuses unless --major says
// the deck was ported.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FILES, RUNTIME_DIR, SOURCE, majorOf, pinOf, setPin, versionOf } from './runtime.mjs';

const args = process.argv.slice(2);
const deckArg = args.find(a => !a.startsWith('--'));
if (!deckArg) { console.error('usage: install.mjs <deck.html> [--check] [--major]'); process.exit(2); }
const DECK = resolve(deckArg), DIR = join(dirname(DECK), RUNTIME_DIR);
if (!existsSync(DECK)) { console.error('no such file:', DECK); process.exit(2); }

const read = (f, enc) => { try { return readFileSync(f, enc); } catch { return null; } };
const version = versionOf(readFileSync(join(SOURCE, 'deckadence.js'), 'utf8')), major = majorOf(version);
const html = readFileSync(DECK, 'utf8'), pin = pinOf(html);
const had = versionOf(read(join(DIR, 'deckadence.js'), 'utf8') || '');

if (args.includes('--check')) {
  const stale = FILES.filter(f => { const a = read(join(DIR, f)); return !a || !a.equals(readFileSync(join(SOURCE, f))); });
  if (pin !== major) console.log(`FAIL pin: the deck is pinned to ${pin || '(none)'}, the runtime is ${version}`);
  stale.forEach(f => console.log(`FAIL ${RUNTIME_DIR}/${f} differs from the runtime ${version} (run install.mjs ${deckArg})`));
  if (pin === major && !stale.length) console.log(`  ok runtime ${version} installed`);
  process.exit(pin === major && !stale.length ? 0 : 1);
}

if (pin && pin !== major && !args.includes('--major')) {
  console.error(`refused: the deck is pinned to runtime ${pin}, this is runtime ${version}. A new major can break the deck's`,
    'markup or scenes: port it (references/engine.md), then run again with --major.');
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });
FILES.forEach(f => copyFileSync(join(SOURCE, f), join(DIR, f)));
if (pin !== major) writeFileSync(DECK, setPin(html, major));
console.log(`runtime ${version} installed in ${DIR}` + (had && had !== version ? ` (was ${had})` : '') + (pin !== major ? `; pin set to ${major}` : ''));
