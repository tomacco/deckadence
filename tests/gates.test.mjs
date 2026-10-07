// check.mjs: passes the shipped decks, and FAILS each class of broken deck it exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE, LANDING, scratchDeck, once, check } from './helpers.mjs';

test('template passes the static gates', () => {
  const r = check(TEMPLATE);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /flash guard: goto\(\) primes/);
});

test('landing passes the static gates', () => {
  const r = check(LANDING);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /every scene has prep\(el\) \(7\)/);
});

// Each case: a one-line mutation of the template (or, as { js }, of its runtime), and the FAIL line it must produce.
const broken = [
  ['goto() stops priming the destination (the final-state flash)',
    { js: s => once(s, '    primeStation(s);\n    const reveal', '    const reveal') },
    /FAIL flash guard: goto\(\) never calls primeStation/],
  ['a scene loses prep(el) (resets on arrival)',
    s => once(s, '    prep(el) {\n', '    setup(el) {\n'),
    /FAIL flash guard: scene "diagram" has no prep/],
  ['the engine has no primeStation at all (a pre-fix deck)',
    { js: s => s.replaceAll('primeStation', 'unusedHelper') },
    /FAIL flash guard: no primeStation\(\)/],
  ['a station steps up instead of right/down',
    s => once(s, 'data-key="LYRA" data-name="The claim" data-x="2300" data-y="0"', 'data-key="LYRA" data-name="The claim" data-x="2300" data-y="-1450"'),
    /FAIL staircase/],
  ['a data-scene nobody registered',
    s => once(s, 'data-y="2900" data-scene="diagram"', 'data-y="2900" data-scene="nosuchscene"'),
    /FAIL data-scene="nosuchscene" is not registered/],
  ['the full-screen button is removed',
    s => s.replace(/<button id="fsbtn"[\s\S]*?<\/button>/, ''),
    /FAIL device chrome: no #fsbtn/],
  ['two stations share a key',
    s => once(s, 'data-key="ORION"', 'data-key="LYRA"'),
    /FAIL/],
];
for (const [name, mutate, expect] of broken) {
  test(`gate fails when ${name}`, () => {
    const r = check(typeof mutate === 'function' ? scratchDeck(TEMPLATE, mutate) : scratchDeck(TEMPLATE, undefined, mutate));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, expect);
  });
}

test('CSS scoped to a positional #sN id is reported', () => {
  const r = check(scratchDeck(TEMPLATE, s => once(s, '</style>', '  #s4 .agenda { gap: 1px; }\n</style>')));
  assert.match(r.out, /scoped to station id #s4/);
});

test('data-fly="through-overview" is a runtime fly (it used to be an add-on spliced into goto())', () => {
  const r = check(scratchDeck(TEMPLATE, s => once(s, 'data-name="Thanks" data-x="6900" data-y="2900"', 'data-name="Thanks" data-x="6900" data-y="2900" data-fly="through-overview"')));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok flies handled \(through-overview\)/);
  const gone = check(scratchDeck(TEMPLATE, s => once(s, 'data-name="Thanks" data-x="6900" data-y="2900"', 'data-name="Thanks" data-x="6900" data-y="2900" data-fly="through-overview"'),
    { js: s => once(s, "dataset.fly === 'through-overview'", "dataset.fly === 'removed'") }));
  assert.match(gone.out, /FAIL data-fly="through-overview" is never handled/);
});
