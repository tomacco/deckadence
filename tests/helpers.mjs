// Shared test helpers. Zero dependencies: node:test + the repo's own tools.
import { spawnSync, execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE = join(ROOT, 'template/starter.html');
export const LANDING = join(ROOT, 'docs/index.html');
export const read = p => readFileSync(p, 'utf8');

/** A scratch folder holding `index.html` (optionally transformed), its runtime (deckadence/, optionally
 *  transformed: `runtime.js` / `runtime.css` edit the engine itself) and the landing's vendored anime.js. */
export function scratchDeck(src = TEMPLATE, transform = s => s, runtime = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deck-test-'));
  const html = transform(read(src));
  writeFileSync(join(dir, 'index.html'), html);
  cpSync(join(ROOT, 'docs/vendor'), join(dir, 'vendor'), { recursive: true });
  copyRuntime(dirname(src), dir, runtime);
  return join(dir, 'index.html');
}
/** Copy a deck's runtime folder, applying `{ js, css }` transforms to deckadence.js / deckadence.css. */
export function copyRuntime(fromDir, toDir, { js = s => s, css = s => s } = {}) {
  const from = join(fromDir, 'deckadence'), to = join(toDir, 'deckadence');
  if (!existsSync(from)) return;
  cpSync(from, to, { recursive: true });
  writeFileSync(join(to, 'deckadence.js'), js(read(join(from, 'deckadence.js'))));
  writeFileSync(join(to, 'deckadence.css'), css(read(join(from, 'deckadence.css'))));
}

/** Replace exactly one occurrence, or throw: a mutation that silently misses would make a
 *  "the gate fails on X" test pass for the wrong reason. */
export function once(s, find, replace) {
  const n = s.split(find).length - 1;
  if (n !== 1) throw new Error(`expected 1 occurrence, found ${n}: ${find.slice(0, 60)}`);
  return s.replace(find, replace);
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, timeout: opts.timeout || 60_000, input: opts.input,
    env: { ...process.env, ...(opts.env || {}) } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
/** Async twin of run(): lets browser tests run side by side (spawnSync blocks the event loop). */
export function runAsync(cmd, args, opts = {}) {
  return new Promise(res => execFile(cmd, args, { encoding: 'utf8', cwd: ROOT, timeout: opts.timeout || 60_000,
    env: { ...process.env, ...(opts.env || {}) }, maxBuffer: 16 << 20 },
    (err, stdout, stderr) => res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout + stderr })));
}
export const check = file => run(process.execPath, [join(ROOT, 'components/verify/check.mjs'), file]);

export function findChrome() {
  return [process.env.DECK_BROWSER,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
}
