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

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

export const FORMAT = 'deckadence-review/1';
export const sidecarPath = deck => deck.replace(/\.html?$/i, '') + '.review.json';

export function load(deck) {
  const p = sidecarPath(deck);
  if (!existsSync(p)) return { format: FORMAT, deck: basename(deck), comments: [], edits: [] };
  const d = JSON.parse(readFileSync(p, 'utf8'));
  d.comments ||= []; d.edits ||= [];
  return d;
}

/** Atomic: write a temp file next to it, then rename — a reader never sees half a file. */
export function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
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
