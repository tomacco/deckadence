// COMPONENT · edit/sidecar — the ONE file an agent reads to know what the human did in the
//   browser: text edits, reorders, comments, replies, and decisions on proposals.
// WHAT  · `deck/index.html` → `deck/index.review.json`. Plain JSON, append-mostly, atomic writes.
// SPLICE · none — a module used by serve.mjs and review.mjs.
//
// Shape (format "deckadence-review/1"):
//   comments[]: { id, station, at:{x,y} (px in the 1920x1080 frame), anchor:{selector,text},
//                 text, author, created, resolved, resolvedBy?, resolvedAt?,
//                 replies[]: { id, author, role:"human"|"agent", created, text,
//                              proposal?: { summary, patch?: { find, replace } },
//                              decision?: { choice:"apply"|"keep"|"other", text?, by, at,
//                                           applied?, error? } } }
//   edits[]:    { id, kind:"text"|"reorder"|"patch", at, author, station?, key?, selector?,
//                 before, after }
// Resolved comments STAY (resolved:true) — the review history of a deck is not thrown away.

import { readFileSync, writeFileSync, renameSync, existsSync, openSync, writeSync, closeSync, unlinkSync, statSync, linkSync } from 'node:fs';
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';

export const FORMAT = 'deckadence-review/1';
export const sidecarPath = deck => deck.replace(/\.html?$/i, '') + '.review.json';

/** Read the sidecar. A file that is not valid JSON, or not the shape above, THROWS with a
 *  message a human can act on — writers must never "repair" it by overwriting it. */
export function load(deck) {
  const p = sidecarPath(deck);
  if (!existsSync(p)) return { format: FORMAT, deck: basename(deck), comments: [], edits: [] };
  let d;
  try { d = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`${basename(p)} is not valid JSON (${e.message}) — fix it by hand or move it aside; nothing is written until it reads`); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${basename(p)} is not a review object — fix it by hand or move it aside`);
  for (const k of ['comments', 'edits'])
    if (d[k] != null && !Array.isArray(d[k])) throw new Error(`${basename(p)}: "${k}" must be a list — fix it by hand or move it aside`);
  d.comments ||= []; d.edits ||= [];
  return d;
}

/* ---------- one writer at a time, across processes ----------
 * The server (serve.mjs) and the agent's CLI (review.mjs) both read-modify-write the sidecar.
 * Every write goes through withLock(): an O_EXCL lock file next to the sidecar, holding the
 * writer's pid. Inside the lock the sidecar is READ AGAIN, so a change is always applied to
 * the latest file, never to a copy loaded before someone else saved. A lock whose pid is dead,
 * or older than STALE_MS, is broken (a crashed writer never blocks the deck for good).
 * Breaking is race-safe: the stale lock is RENAMED aside (only one breaker can win that) and
 * re-checked there; a lock that turns out to be live is put back with link(), which never
 * overwrites. A writer removes the lock on exit only if it still holds ITS token. */
export const lockPath = deck => sidecarPath(deck) + '.lock';
const STALE_MS = 15000, WAIT_MS = 5000;
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function stale(p) {
  try {
    if (Date.now() - statSync(p).mtimeMs > STALE_MS) return true;
    const pid = parseInt(readFileSync(p, 'utf8'), 10);
    return pid > 0 && pid !== process.pid && !alive(pid);
  } catch { return false; }   // it vanished: just retry
}
function breakStale(p) {
  const aside = `${p}.${process.pid}.${randomBytes(3).toString('hex')}.stale`;
  try { renameSync(p, aside); } catch { return; }            // someone else broke (or released) it
  if (!stale(aside)) { try { linkSync(aside, p); } catch {} } // it was live after all: put it back
  try { unlinkSync(aside); } catch {}
}
export function withLock(deck, fn) {
  const p = lockPath(deck), t0 = Date.now(), token = `${process.pid} ${randomBytes(6).toString('hex')}\n`;
  let fd;
  for (;;) {
    try { fd = openSync(p, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (stale(p)) { breakStale(p); continue; }
      if (Date.now() - t0 > WAIT_MS) throw new Error(`${basename(p)} is held by another writer — if no serve.mjs or review.mjs is running, delete it`);
      nap(10);
    }
  }
  try { writeSync(fd, token); closeSync(fd); return fn(); }
  finally { try { if (readFileSync(p, 'utf8') === token) unlinkSync(p); } catch {} }
}
/** Locked read-modify-write: fn(freshData) mutates it; saved unless fn returns false. */
export function update(deck, fn) {
  return withLock(deck, () => { const d = load(deck); const r = fn(d); if (r !== false) save(deck, d); return r; });
}

/** Atomic: write a temp file next to it, then rename — a reader never sees half a file. */
export function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(3).toString('hex')}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, path); }
  catch (e) { try { unlinkSync(tmp); } catch {} throw e; }   // never leave a .tmp behind
}

export function save(deck, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  writeAtomic(sidecarPath(deck), text);
  return text;
}

export const now = () => new Date().toISOString();
export function nextId(prefix, list) {
  const n = list.reduce((m, x) => Math.max(m, +(String(x.id).match(/(\d+)$/) || [0, 0])[1]), 0);
  return `${prefix}${n + 1}`;
}
export const findComment = (d, id) => d.comments.find(c => c.id === id);
export function findReply(d, rid) {
  for (const c of d.comments) for (const r of c.replies || []) if (r.id === rid) return { comment: c, reply: r };
  return null;
}
