// edit/source.mjs: the byte-exact write-back behind edit mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../components/edit/source.mjs';
import { TEMPLATE, read, scratchDeck, check } from './helpers.mjs';
import { writeFileSync } from 'node:fs';

const html = read(TEMPLATE);
const units = S.editMap(html);
const unit = (id, re) => units[id].find(u => re.test(u.text));

test('editMap finds the editable text of every station', () => {
  assert.equal(Object.keys(units).length, 6);
  assert.ok(unit('s1', /Your big idea/), 'title heading is editable');
});

test('a one-word edit changes only that word', () => {
  const u = unit('s1', /Your big idea/);
  const r = S.applyText(html, u.key, u.html, u.html.replace('big', 'bold'));
  assert.ok(!r.error, r.error);
  assert.equal(r.html.length, html.length + 1);          // "big" -> "bold"
  const at = html.indexOf('big idea');
  assert.equal(r.html.slice(0, at), html.slice(0, at));   // everything before: untouched
  assert.equal(r.html.slice(at + 4), html.slice(at + 3)); // everything after: untouched
});

test('an edit against stale text is refused, never clobbers', () => {
  const u = unit('s1', /Your big idea/);
  const r = S.applyText(html, u.key, 'something else', 'x');
  assert.equal(r.status, 409);
});

test('applyPatch replaces exactly one match inside the station', () => {
  const ok = S.applyPatch(html, 's2', 'claim <span', 'point <span');
  assert.ok(!ok.error, ok.error);
  assert.match(ok.html, /Make one<br>point <span/);
  assert.match(S.applyPatch(html, 's2', 'not in this station', 'x').error, /no longer in that station/);
  assert.match(S.applyPatch(html, 's4', 'a', 'b').error, /more than once/);
});

test('reorder keeps ids, keys and a valid staircase', () => {
  const order = ['s1', 's3', 's2', 's4', 's5', 's6'];
  const r = S.reorder(html, order);
  assert.ok(!r.error, r.error);
  const after = S.stations(r.html).map(s => s.id);
  assert.deepEqual(after, order);
  const file = scratchDeck(); writeFileSync(file, r.html);
  const g = check(file);
  assert.equal(g.code, 0, g.out);
});

test('reorder refuses an order that drops a station', () => {
  assert.match(S.reorder(html, ['s1', 's2']).error, /every station exactly once/);
});
