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
//   inside the comment's station — add "station" to target another). Without it, Apply means
//   "yes, do it" and YOU make the change on your next turn.
// The browser (serve.mjs) watches the sidecar: a reply appears in the open deck live.

import { readFileSync } from 'node:fs';
import * as R from './sidecar.mjs';

const [deck, cmd = 'status', id] = process.argv.slice(2).filter(a => a !== '--json');
const JSON_OUT = process.argv.includes('--json');
if (!deck) { console.error('usage: review.mjs <deck.html> [status|reply <id>|resolve <id>|reopen <id>] [--json]'); process.exit(1); }
const author = process.env.DECK_AGENT || 'Claude';
const d = R.load(deck);

if (cmd === 'status') {
  const open = d.comments.filter(c => !c.resolved);
  const decisions = [];
  for (const c of d.comments) for (const r of c.replies || []) if (r.decision) decisions.push({ comment: c.id, reply: r.id, summary: r.proposal?.summary, ...r.decision });
  if (JSON_OUT) { console.log(JSON.stringify({ open, decisions, edits: d.edits }, null, 2)); process.exit(0); }
  console.log(`${R.sidecarPath(deck)} · ${open.length} open comment(s) · ${decisions.length} decision(s) · ${d.edits.length} edit(s)\n`);
  for (const c of open) {
    console.log(`${c.id} · ${c.station} · ${c.author} · ${c.created}`);
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
    for (const e of d.edits.slice(-15)) console.log(`   ${e.id} ${e.at} ${e.kind}${e.station ? ' ' + e.station : ''}: ${JSON.stringify(e.before).slice(0, 70)} → ${JSON.stringify(e.after).slice(0, 70)}`);
  }
} else if (cmd === 'reply') {
  const c = R.findComment(d, id);
  if (!c) { console.error(`no comment ${id}`); process.exit(1); }
  const b = JSON.parse(readFileSync(0, 'utf8'));
  if (!String(b.text || '').trim()) { console.error('reply needs "text"'); process.exit(1); }
  c.replies ||= [];
  const r = { id: `${c.id}.r${c.replies.length + 1}`, author, role: 'agent', created: R.now(), text: String(b.text).trim() };
  if (b.proposal) r.proposal = b.proposal;
  c.replies.push(r);
  R.save(deck, d);
  console.log(`replied ${r.id}${r.proposal ? ' with a proposal' : ''}`);
} else if (cmd === 'resolve' || cmd === 'reopen') {
  const c = R.findComment(d, id);
  if (!c) { console.error(`no comment ${id}`); process.exit(1); }
  c.resolved = cmd === 'resolve';
  if (c.resolved) { c.resolvedBy = author; c.resolvedAt = R.now(); } else { delete c.resolvedBy; delete c.resolvedAt; }
  R.save(deck, d);
  console.log(`${cmd}d ${c.id}`);
} else { console.error(`unknown command ${cmd}`); process.exit(1); }
