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

import { readFileSync, writeFileSync, renameSync, existsSync, openSync, writeSync, closeSync, unlinkSync, statSync, fstatSync, readSync } from 'node:fs';
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
 * or that is held by a live process for longer than any real write, is broken (a crashed writer never
 * blocks the deck for good). Breakers are serialised by a second O_EXCL lock (`.lock.break`):
 * under it the lock is re-read and re-judged, and only then unlinked, so a breaker can never
 * remove a lock someone took after it looked. An empty or unreadable lock that is fresh is
 * LIVE (its writer is between open and write). A writer removes the lock on exit only if it
 * still holds its own token. */
export const lockPath = deck => sidecarPath(deck) + '.lock';
const WAIT_MS = 5000, EMPTY_STALE_MS = 15000, LIVE_STALE_MS = 10 * 60000, BREAK_STALE_MS = 30000;
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
// The lock's identity (inode) if it is stale, else 0. Size, age and pid come from ONE open
// file, so a lock released and retaken mid-check is never judged by its predecessor's age.
function stale(p) {
  let fd;
  try {
    fd = openSync(p, 'r');
    const st = fstatSync(fd), age = Date.now() - st.mtimeMs;
    const buf = Buffer.alloc(64), n = readSync(fd, buf, 0, 64, 0);
    const pid = parseInt(buf.toString('utf8', 0, n), 10);
    let dead;
    if (!(pid > 0)) dead = age > EMPTY_STALE_MS;             // no pid yet: live unless old
    else if (pid === process.pid) dead = true;               // withLock is sync, not re-entrant: a leftover of ours
    else dead = !alive(pid) || age > LIVE_STALE_MS;
    return dead ? st.ino || -1 : 0;
  } catch { return 0; }                                      // it vanished: just retry
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}
function breakStale(p) {
  const b = p + '.break';
  let fd;
  try { fd = openSync(b, 'wx'); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // another breaker is at work; its critical section is a stat, a read and an unlink, so a
    // .break this old belongs to a breaker that was killed mid-way
    try { if (Date.now() - statSync(b).mtimeMs > BREAK_STALE_MS) unlinkSync(b); } catch {}
    return;
  }
  try {
    closeSync(fd);
    const ino = stale(p);                                    // re-judged under the break lock
    if (ino && (ino === -1 || statSync(p).ino === ino)) unlinkSync(p);
  } catch {}
  finally { try { unlinkSync(b); } catch {} }
}
export function withLock(deck, fn) {
  const p = lockPath(deck), t0 = Date.now(), token = `${process.pid} ${randomBytes(6).toString('hex')}\n`;
  let fd;
  for (;;) {
    try { fd = openSync(p, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - t0 > WAIT_MS) throw new Error(`${basename(p)} is held by another writer — if no serve.mjs or review.mjs is running, delete it`);
      if (stale(p)) { breakStale(p); nap(1); continue; }
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
