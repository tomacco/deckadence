// Live window + packing, without a browser: the pack tool's output and the static gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE, LANDING, read, scratchDeck, once, check } from './helpers.mjs';
import { pack, fragmentName } from '../components/stream/pack.mjs';
import * as S from '../components/edit/source.mjs';

const html = read(TEMPLATE);

test('pack (default) wraps every station, byte-for-byte, in <template data-station>', () => {
  const src = S.stations(html), out = pack(html).html, packed = S.stations(out);
  assert.equal(packed.length, src.length);
  packed.forEach((st, k) => {
    const body = S.inner(out, st.el);
    assert.ok(body.startsWith('<template data-station>') && body.endsWith('</template>'), st.id);
    assert.equal(body.slice('<template data-station>'.length, -'</template>'.length), S.inner(html, src[k].el), st.id);
  });
  // nothing outside the stations changed
  assert.equal(out.slice(0, packed[0].el.start), html.slice(0, src[0].el.start));
  assert.equal(out.slice(packed.at(-1).el.end), html.slice(src.at(-1).el.end));
});

test('pack --split moves each station to a fragment and leaves an empty frame with data-src', () => {
  const src = S.stations(html), { html: out, fragments } = pack(html, { split: true }), packed = S.stations(out);
  assert.equal(fragments.length, src.length);
  packed.forEach((st, k) => {
    assert.equal(S.inner(out, st.el), '', st.id);
    assert.equal(st.el.attrs['data-src'], 'stations/' + fragmentName(src[k]));
    assert.equal(fragments[k].content, S.inner(html, src[k].el), st.id);
    // the frame keeps everything the engine places and styles it by
    for (const a of ['id', 'class', 'data-key', 'data-x', 'data-y']) assert.equal(st.el.attrs[a], src[k].el.attrs[a], `${st.id} ${a}`);
  });
});

test('pack adds posters only to the stations that have one', () => {
  const out = pack(html, { posters: { s1: 'posters/VEGA.png' } }).html, st = S.stations(out);
  assert.equal(st[0].el.attrs['data-poster'], 'posters/VEGA.png');
  assert.equal(st[1].el.attrs['data-poster'], undefined);
});

test('pack refuses what it cannot stream', () => {
  assert.throws(() => pack(read(LANDING)), /no live window/);                 // an engine that predates mountStation
  assert.throws(() => pack(pack(html).html), /already packed/);                // packing twice
  const dup = once(html, 'data-key="LYRA"', 'data-key="VEGA"');
  assert.throws(() => pack(dup, { split: true }), /share the fragment VEGA\.html/);
});

test('fragment names come from the stable key and are safe file names', () => {
  assert.equal(fragmentName({ key: 'VEGA', id: 's1' }), 'VEGA.html');
  assert.equal(fragmentName({ key: null, id: 's7' }), 's7.html');
  assert.equal(fragmentName({ key: '../x y', id: 's7' }), '___x_y.html');
});

test('check.mjs: the template passes the live-window gate', () => {
  const r = check(scratchDeck(TEMPLATE));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok live window/);
});

test('check.mjs: an engine with the window but no paint gate FAILS', () => {
  const r = check(scratchDeck(TEMPLATE, s => once(s, '  body:not(.deck-ready) #world { visibility: hidden; }', '')));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL live window: the plane can paint before the engine runs/);
});

test('check.mjs: an engine without the window only WARNS (old decks still pass)', () => {
  const r = check(LANDING);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARN live window: this engine keeps every station in memory/);
});
