#!/usr/bin/env node
// COMPONENT · edit/review — the AGENT's side of edit mode. Reads and answers the sidecar.
//   node components/edit/review.mjs deck/index.html                 # what needs you: open comments, decisions, edits
//   node components/edit/review.mjs deck/index.html --json          # the same, machine-readable
//   node components/edit/review.mjs deck/index.html reply c3 < reply.json
//   node components/edit/review.mjs deck/index.html resolve c3
// reply.json (on STDIN — prose never goes through a shell argument):
//   { "text": "Tightened it to one line.",
//     "proposal": { "summary": "Shorten the heading",
//                   "patch": { "find": "Invert contrast<br>to mark a turn", "replace": "Invert to turn" } } }
//   `patch` is optional. With it, the human's Apply writes the change at once (exact match, once,
//   inside the comment's station — add "station": "<KEY or id>" to target another). Without it, Apply means
//   "yes, do it" and YOU make the change on your next turn.
// The browser (serve.mjs) watches the sidecar: a reply appears in the open deck live.
// Writes take the sidecar's lock (sidecar.mjs withLock) and re-read the file inside it, so a
// reply never overwrites a comment the human posted a moment earlier through the server.

import { readFileSync } from 'node:fs';
import * as R from './sidecar.mjs';

const [deck, cmd = 'status', id] = process.argv.slice(2).filter(a => a !== '--json');
const JSON_OUT = process.argv.includes('--json');
if (!deck) { console.error('usage: review.mjs <deck.html> [status|reply <id>|resolve <id>|reopen <id>] [--json]'); process.exit(1); }
const author = process.env.DECK_AGENT || 'Claude';
let d;
try { d = R.load(deck); } catch (e) { console.error(e.message); process.exit(1); }
const fail = msg => { console.error(msg); process.exit(1); };
// Locked read-modify-write; throw (never exit) inside it, so the lock is always released.
const update = fn => { try { return R.update(deck, fn); } catch (e) { fail(e.message); } };

// A station as a human says it: its KEY (stable across reorders), with the id as a hint.
const where = r => r.stationKey ? `${r.stationKey} (${r.station})` : r.station;

if (cmd === 'status') {
  const open = d.comments.filter(c => !c.resolved);
  const decisions = [];
  for (const c of d.comments) for (const r of c.replies || []) if (r.decision) decisions.push({ comment: c.id, reply: r.id, summary: r.proposal?.summary, ...r.decision });
  if (JSON_OUT) { console.log(JSON.stringify({ open, decisions, edits: d.edits }, null, 2)); process.exit(0); }
  console.log(`${R.sidecarPath(deck)} · ${open.length} open comment(s) · ${decisions.length} decision(s) · ${d.edits.length} edit(s)\n`);
  for (const c of open) {
    console.log(`${c.id} · ${where(c)} · ${c.author} · ${c.created}`);
    if (c.anchor) console.log(`   at   ${c.anchor.selector}${c.anchor.text ? `  "${c.anchor.text}"` : ''}`);
    else console.log(`   at   (${c.at.x}, ${c.at.y}) in the 1920x1080 frame`);
    console.log(`   says ${c.text}`);
    for (const r of c.replies || []) {
      console.log(`   ${r.id} ${r.role}: ${r.text}`);
      if (r.proposal) console.log(`      proposal: ${r.proposal.summary || ''} → ${r.decision ? `DECIDED ${r.decision.choice}${r.decision.text ? ` "${r.decision.text}"` : ''}${r.decision.applied === false ? ` (patch FAILED: ${r.decision.error})` : r.decision.applied ? ' (applied)' : ''}` : 'awaiting the human'}`);
    }
    console.log('');
  }
  if (d.edits.length) {
    console.log('edits made in the browser (newest last):');
    for (const e of d.edits.slice(-15)) {
      const [bf, af] = e.afterKeys ? [e.beforeKeys, e.afterKeys] : [e.before, e.after];   // a reorder, by key
      console.log(`   ${e.id} ${e.at} ${e.kind}${e.station ? ' ' + where(e) : ''}: ${JSON.stringify(bf).slice(0, 70)} → ${JSON.stringify(af).slice(0, 70)}`);
    }
  }
} else if (cmd === 'reply') {
  let b; try { b = JSON.parse(readFileSync(0, 'utf8')); } catch (e) { fail(`reply.json on STDIN is not valid JSON (${e.message})`); }
  if (!String(b.text || '').trim()) fail('reply needs "text"');
  const r = update(fresh => {
    const c = R.findComment(fresh, id);
    if (!c) throw new Error(`no comment ${id}`);
    c.replies ||= [];
    const r = { id: `${c.id}.r${c.replies.length + 1}`, author, role: 'agent', created: R.now(), text: String(b.text).trim() };
    if (b.proposal) r.proposal = b.proposal;
    c.replies.push(r);
    return r;
  });
  console.log(`replied ${r.id}${r.proposal ? ' with a proposal' : ''}`);
} else if (cmd === 'resolve' || cmd === 'reopen') {
  update(fresh => {
    const c = R.findComment(fresh, id);
    if (!c) throw new Error(`no comment ${id}`);
    c.resolved = cmd === 'resolve';
    if (c.resolved) { c.resolvedBy = author; c.resolvedAt = R.now(); } else { delete c.resolvedBy; delete c.resolvedAt; }
  });
  console.log(`${cmd}d ${id}`);
} else fail(`unknown command ${cmd}`);
