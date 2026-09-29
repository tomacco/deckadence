// COMPONENT · edit/source — the deck's SOURCE as data: an offset-preserving element tree,
//   the editable-text map, surgical text write-back, and station reorder + staircase relayout.
// WHAT  · Everything edit mode writes goes through here, as a SPLICE into the original text.
//         The document is never re-serialised, so a one-word edit is a one-word diff.
// SPLICE · none — a module used by serve.mjs and review.mjs. No deps (node or bun).
//
// Why a tokenizer and not a DOM: a DOM forgets where things were in the file. Write-back must
// replace bytes [a, b) of the source and leave every other byte (quotes, indentation, comments,
// line endings) exactly as the author or agent left it.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
// Inline phrasing a text edit may pass THROUGH. An element whose content is only text and
// these is one editable unit (a heading with an .accent span, an agenda line with its number).
const INLINE = new Set(['span', 'em', 'strong', 'b', 'i', 'u', 's', 'a', 'small', 'mark', 'sup', 'sub',
  'code', 'abbr', 'q', 'br', 'wbr', 'del', 'ins', 'kbd', 'time']);

const TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

/** Parse HTML into an element tree that remembers offsets:
 *  start (at '<'), openEnd (after the open tag's '>'), closeStart (at '</'), end (after '>'). */
export function parse(html) {
  const root = { tag: '#root', attrs: {}, start: 0, openEnd: 0, closeStart: html.length, end: html.length, children: [], parent: null };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? html.length : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e < 0 ? html.length : e + 1; continue; }
    if (html[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(lt, lt + 80));
      if (!m) { i = lt + 1; continue; }
      const name = m[1].toLowerCase();
      // tolerant close: pop to the nearest matching open element (unclosed <p>/<li> get closed)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name) {
          while (stack.length > k + 1) { const el = stack.pop(); el.closeStart = el.end = lt; }  // implicitly closed
          const el = stack.pop(); el.closeStart = lt; el.end = lt + m[0].length;
          break;
        }
      }
      i = lt + m[0].length;
      continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(html);
    if (!m) { i = lt + 1; continue; }
    const tag = m[1].toLowerCase();
    const el = { tag, attrs: parseAttrs(m[2]), start: lt, openEnd: lt + m[0].length, closeStart: -1, end: -1, children: [], parent: top() };
    top().children.push(el);
    i = el.openEnd;
    if (VOID.has(tag) || m[3] === '/') { el.closeStart = el.end = el.openEnd; continue; }
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      el.closeStart = close < 0 ? html.length : close;
      const gt = html.indexOf('>', el.closeStart);
      el.end = gt < 0 ? html.length : gt + 1;
      i = el.end;
      continue;
    }
    stack.push(el);
  }
  while (stack.length > 1) { const el = stack.pop(); el.closeStart = el.end = html.length; }
  return root;
}

export function* walk(el) { for (const c of el.children) { yield c; yield* walk(c); } }
const hasClass = (el, c) => (el.attrs.class || '').split(/\s+/).includes(c);
export const inner = (html, el) => html.slice(el.openEnd, el.closeStart);

/** Stations in DOM order: { id, name, x, y, el }. */
export function stations(html, tree = parse(html)) {
  const out = [];
  for (const el of walk(tree)) if (el.tag === 'section' && hasClass(el, 'station'))
    out.push({ id: el.attrs.id, name: el.attrs['data-name'] || el.attrs.id, x: +el.attrs['data-x'], y: +el.attrs['data-y'], el });
  return out;
}

function inlineOnly(el) {
  return el.children.every(c => INLINE.has(c.tag) && inlineOnly(c));
}
const plain = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Editable text units per station: the OUTERMOST elements whose content is text + inline
 *  phrasing. Address = station id + element-child index path (stable across a reveal: the
 *  engine's splitLines only rewrites a heading's INSIDE, never its position). */
export function editMap(html, tree = parse(html)) {
  const map = {};
  for (const st of stations(html, tree)) {
    const units = [];
    const visit = (el, path) => el.children.forEach((c, k) => {
      const p = [...path, k];
      if (c.tag === 'svg' || RAW.has(c.tag) || c.tag === 'iframe') return;
      if (!VOID.has(c.tag) && inlineOnly(c) && plain(inner(html, c))) {
        units.push({ key: `${st.id}:${p.join('.')}`, path: p, tag: c.tag, cls: c.attrs.class || '', html: inner(html, c), text: plain(inner(html, c)) });
        return;
      }
      visit(c, p);
    });
    visit(st.el, []);
    map[st.id] = units;
  }
  return map;
}

export function resolve(html, key, tree = parse(html)) {
  const [id, p] = key.split(':');
  const st = stations(html, tree).find(s => s.id === id);
  if (!st) return null;
  let el = st.el;
  for (const k of p.split('.').map(Number)) { el = el.children[k]; if (!el) return null; }
  return { station: st, el };
}

/* ---------- text write-back ---------- */

// A text edit may change TEXT and line breaks (<br> is how a heading sets its line count).
// Anything else — a dropped .accent span, a <div> the browser inserted on Enter — is a
// STRUCTURE change and is refused: classes and attributes are what the engine reads.
function tokens(s) {
  const out = []; const re = /<\/?([a-zA-Z][\w:-]*)[^>]*>|<!--[\s\S]*?-->|[^<]+|</g;
  for (const m of s.matchAll(re)) {
    if (m[0].startsWith('<!--')) out.push({ t: 'comment', s: m[0] });
    else if (m[1]) out.push({ t: 'tag', s: m[0], name: m[1].toLowerCase(), close: m[0][1] === '/' });
    else out.push({ t: 'text', s: m[0] });
  }
  return out;
}
const skeleton = toks => toks.filter(x => x.t === 'tag' && x.name !== 'br' && x.name !== 'wbr');
const sameTag = (a, b) => a.name === b.name && a.close === b.close &&
  JSON.stringify(parseAttrs(a.s.replace(/^<\/?[\w:-]+|\/?>$/g, ''))) === JSON.stringify(parseAttrs(b.s.replace(/^<\/?[\w:-]+|\/?>$/g, '')));

// Entities, decoded, so an unchanged run is recognised however it was spelled: the browser
// serialises `&mdash;` back as `—`, and a blur without typing must not rewrite the source.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', ensp: ' ', emsp: ' ',
  thinsp: ' ', hairsp: ' ', zwj: '‍', zwnj: '‌', mdash: '—', ndash: '–', minus: '−', hellip: '…',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  middot: '·', bull: '•', times: '×', divide: '÷', plusmn: '±', deg: '°', prime: '′', Prime: '″', copy: '©', reg: '®',
  trade: '™', sect: '§', para: '¶', dagger: '†', Dagger: '‡', euro: '€', pound: '£', yen: '¥', cent: '¢', larr: '←',
  rarr: '→', uarr: '↑', darr: '↓', harr: '↔', lArr: '⇐', rArr: '⇒', hArr: '⇔', le: '≤', ge: '≥', ne: '≠', asymp: '≈',
  infin: '∞', check: '✓', iexcl: '¡', iquest: '¿', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ' };
export function decode(s) {
  return s.replace(/&(?:#(\d+)|#[xX]([\da-fA-F]+)|([a-zA-Z][a-zA-Z\d]*));?/g, (m, d, h, n) => {
    if (n) return ENT[n] ?? m;
    const cp = d ? +d : parseInt(h, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}
// A run of tokens as the reader sees it: decoded text, a line break as \n.
const seen = toks => toks.map(x => x.t === 'text' ? decode(x.s) : x.name === 'br' ? '\n' : '').join('');

/** Merge a browser-serialised edit onto the source inner HTML. Keeps the SOURCE spelling of
 *  every tag (quotes, attribute order), and of every text run whose decoded text did not
 *  change (entities like `&mdash;` survive a save that did not touch them); takes only text
 *  + <br> from the edit. Returns { html } or { error }. */
export function mergeText(sourceInner, editedInner) {
  const a = tokens(sourceInner), b = tokens(editedInner.replace(/<br\s*\/?>\s*$/i, ''));  // a trailing <br> is a contenteditable artefact
  const sa = skeleton(a), sb = skeleton(b);
  if (sa.length !== sb.length || sa.some((x, k) => !sameTag(x, sb[k])))
    return { error: 'structure changed — only text and line breaks are editable here' };
  if (b.some(x => x.t === 'comment')) return { error: 'comments are not editable text' };
  const brSpelling = (a.find(x => x.t === 'tag' && x.name === 'br') || { s: '<br>' }).s;
  const keepNbsp = /&nbsp;| /.test(sourceInner);
  for (const x of b) if (x.t === 'text' && !keepNbsp) x.s = x.s.replace(/&nbsp;| /g, ' ');
  // Segments: the runs of text / <br> between two structural tags. Same count on both sides.
  const segs = toks => { const out = [[]]; for (const x of toks) { if (x.t === 'tag' && x.name !== 'br' && x.name !== 'wbr') out.push([]); else out[out.length - 1].push(x); } return out; };
  const ga = segs(a), gb = segs(b);
  let out = '';
  gb.forEach((seg, k) => {
    const src = ga[k];
    if (seen(src) === seen(seg)) out += src.map(x => x.s).join('');          // untouched: source bytes
    else {
      // Same shape of text and breaks: keep the source spelling of each run that did not change.
      const shape = t => t.map(x => x.t === 'text' ? 't' : x.name).join();
      const aligned = !src.some(x => x.t === 'comment') && shape(src) === shape(seg);
      seg.forEach((x, i) => {
        if (x.t === 'text') out += aligned && decode(src[i].s) === decode(x.s) ? src[i].s : x.s;
        else out += x.name === 'br' ? brSpelling : x.s;
      });
    }
    if (k < sa.length) out += sa[k].s;
  });
  return { html: out };
}

/** Replace one unit's inner HTML. `base` = the inner the client started from: if the file
 *  moved underneath (an agent edited it), refuse rather than clobber. */
export function applyText(html, key, base, edited) {
  const r = resolve(html, key);
  if (!r) return { error: `no element at ${key}`, status: 409 };
  const cur = inner(html, r.el);
  if (cur !== base) return { error: 'the file changed under this edit — reloaded the latest text', status: 409 };
  const m = mergeText(cur, edited);
  if (m.error) return { error: m.error, status: 422 };
  if (m.html === cur) return { html, before: cur, after: cur, unchanged: true };
  return { html: html.slice(0, r.el.openEnd) + m.html + html.slice(r.el.closeStart), before: cur, after: m.html, station: r.station.id };
}

/** Exact, single-occurrence find/replace scoped to ONE station's source range (the patch an
 *  agent can attach to a proposal, applied when the human presses Apply). */
export function applyPatch(html, stationId, find, replace) {
  const st = stations(html).find(s => s.id === stationId);
  if (!st) return { error: `no station ${stationId}` };
  const seg = html.slice(st.el.start, st.el.end);
  const at = seg.indexOf(find);
  if (at < 0) return { error: 'the text to replace is no longer in that station' };
  if (seg.indexOf(find, at + 1) >= 0) return { error: 'the text to replace appears more than once in that station' };
  const a = st.el.start + at;
  return { html: html.slice(0, a) + replace + html.slice(a + find.length) };
}

/* ---------- reorder + staircase relayout ---------- */

/** Set one attribute in an open tag's source text. Attributes are found with the tokenizer's
 *  own TAG/ATTR spans, so a `data-x=` inside ANOTHER attribute's value is never touched. */
function setAttr(tagText, name, value) {
  TAG.lastIndex = 0;
  const m = TAG.exec(tagText);
  if (!m) throw new Error(`not an open tag: ${tagText.slice(0, 40)}`);
  const base = 1 + m[1].length;                      // the attribute list starts after '<name'
  for (const a of m[2].matchAll(ATTR)) {
    if (a[1].toLowerCase() !== name) continue;
    const at = base + a.index, eq = /^[^\s"'>\/=]+\s*=\s*/.exec(a[0]);
    const val = eq ? `${a[0].slice(0, eq[0].length)}"${value}"` : `${a[0]}="${value}"`;
    return tagText.slice(0, at) + val + tagText.slice(at + a[0].length);
  }
  const end = base + m[2].length;
  return tagText.slice(0, end) + ` ${name}="${value}"` + tagText.slice(end);
}

/** The staircase as SLOTS: slot k sits at slot k-1 plus the step it had before. Reordering
 *  moves stations between slots, so the map keeps its shape (every step still pure right or
 *  pure down) and ids never change — `#sN` deep links and id-scoped CSS survive. */
export function relayout(list) {
  const steps = list.map((s, k) => k ? { dx: s.x - list[k - 1].x, dy: s.y - list[k - 1].y } : null);
  const out = []; let x = list[0].x, y = list[0].y;
  list.forEach((_, k) => { if (k) { x += steps[k].dx; y += steps[k].dy; } out.push({ x, y }); });
  return out;
}

/** Where a station's NOTE starts inside `gap` (the source between the previous station, or the
 *  parent's open tag, and this station): the comment(s) DIRECTLY above it — no blank line in
 *  between, nothing but whitespace before. Returns gap.length when it has none. A comment
 *  separated by a blank line (the template's layout-rule header above s1) stays put. */
function noteStart(gap) {
  let at = gap.length;
  for (;;) {
    const o = gap.lastIndexOf('<!--', at - 1);
    if (o < 0 || !/^<!--[\s\S]*?-->[ \t]*(?:\r?\n[ \t]*)?$/.test(gap.slice(o, at))) break;
    at = o;
  }
  if (at === gap.length || /\S/.test(gap.slice(0, at).replace(/<!--[\s\S]*?-->/g, ''))) return gap.length;
  return at;
}

/** Reorder stations to `order` (ids) and rewrite every data-x/data-y. A comment directly
 *  above a station (the first one included) is that station's note and travels with it. */
export function reorder(html, order) {
  const list = stations(html);
  const ids = list.map(s => s.id);
  if (order.length !== ids.length || [...order].sort().join() !== [...ids].sort().join())
    return { error: 'order must name every station exactly once' };
  const parent = list[0].el.parent;
  if (list.some(s => s.el.parent !== parent)) return { error: 'stations do not share one parent — reorder by hand' };
  const blocks = list.map((s, k) => {
    const floor = k ? list[k - 1].el.end : parent.openEnd;
    return { id: s.id, start: floor + noteStart(html.slice(floor, s.el.start)), end: s.el.end, tagStart: s.el.start, tagEnd: s.el.openEnd };
  });
  const slots = relayout(list);
  const byId = Object.fromEntries(blocks.map(b => [b.id, b]));
  let out = html.slice(0, blocks[0].start);
  order.forEach((id, k) => {
    const b = byId[id];
    let text = html.slice(b.start, b.end);
    const open = b.tagEnd - b.start, tagStart = b.tagStart - b.start;
    let tag = text.slice(tagStart, open);
    tag = setAttr(setAttr(tag, 'data-x', slots[k].x), 'data-y', slots[k].y);
    text = text.slice(0, tagStart) + tag + text.slice(open);
    out += text;
    if (k < order.length - 1) out += html.slice(blocks[k].end, blocks[k + 1].start);  // original gap k→k+1
  });
  out += html.slice(blocks[blocks.length - 1].end);
  return { html: out, before: ids, after: order };
}
