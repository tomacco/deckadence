# The Engine: Camera Over a World

How the spatial deck works, from zero. The CORE engine (world, camera, fitZoom, goto,
generic intro, HUD, overview, dive, deep links, scene registry) ships working in
`template/starter.html` — copy that file as your starting point; never rebuild the engine
from scratch. Two features are **[ADD-ON]** recipes you splice in only when the talk needs
them: the fly-through-overview move and the full-screen site showcase. Complete code for
both is below.

## Mental model

There are no "slides". There is:

1. **A world** — one absolutely-positioned `<div id="world">` holding every station.
2. **Stations** — fixed **1920×1080** frames (`<section class="station">`) placed at real
   pixel coordinates on that plane via `data-x` / `data-y` (the engine applies
   `transform: translate(x,y)` at boot).
3. **A camera** — a plain object `{x, y, zoom}`. One `render()` function maps it to a single
   transform on `#world`:
   ```js
   translate(vw/2 − cam.x·zoom, vh/2 − cam.y·zoom) scale(zoom)
   ```
   Animate the camera object (anime.js v4) with `onUpdate: render` and the world flies.

Navigation is just "tween the camera to the next station's center at its fitting zoom".

## The invariants (violating any of these has bitten before)

> **NEVER override a station's `position`.** The engine sets `position:absolute` and the
> station is also the containing block for its absolutely-positioned children. A per-station
> layout class that sets `position:relative` renders content off-screen.

> **Fit the frame to the viewport.** `fitZoom(s) = min(vw/s.w, vh/s.h) * s.zoom` makes the
> 16:9 frame bleed edge-to-edge — this is where "big fonts" come from. Never float a
> fixed-size frame inside the screen with margins around it.

> **The letterbox follows the station tone.** On non-16:9 screens the fitted frame leaves
> bars. The `dark-hud` body class flips the viewport background so bars are dark behind dark
> stations.

## Layout: the monotone down/right staircase

**"Next" must always move DOWN or RIGHT — never up or left.** Lay stations out as a
staircase: x and y non-decreasing in DOM order, each step either pure right or pure down.

- Grid units that work at 1920×1080: **right = +2300 px, down = +1450 px**.
- Alternate right/down steps for visual variety; consecutive rights are fine.
- Same-size stations produce no visible zoom — use `data-zoom` (e.g. `1.6` for a tighter
  crop, `0.55` for a pull-back) or a `data-fly="dive"` transition when you want depth.

**Every station insert/delete forces a re-layout of everything after it.** This is a known
recurring manual task. After ANY change to the station list, save this as
`verify-staircase.mjs` next to the deck and run `node verify-staircase.mjs deck/index.html`:

```js
import { readFileSync } from 'node:fs';
const file = process.argv[2] || 'deck/index.html';
const html = readFileSync(file, 'utf8');
const s = [...html.matchAll(/<section\b[^>]*\bclass="[^"]*\bstation\b[^"]*"[^>]*>/g)].map(m => {
  const tag = m[0];
  const attr = n => { const a = tag.match(new RegExp(n + '="(-?[\\w-]+)"')); return a ? a[1] : null; };
  return { id: attr('id'), x: +attr('data-x'), y: +attr('data-y') };
});
if (!s.length || s.some(t => Number.isNaN(t.x) || Number.isNaN(t.y))) {
  console.log('FAIL: parsed', s.length, 'stations (missing data-x/data-y?)'); process.exit(1);
}
let ok = true;
for (let i = 1; i < s.length; i++) {
  const dx = s[i].x - s[i-1].x, dy = s[i].y - s[i-1].y;
  if (!((dx > 0 && dy === 0) || (dy > 0 && dx === 0))) {
    ok = false; console.log('BAD', s[i-1].id, '->', s[i].id, 'dx=' + dx, 'dy=' + dy);
  }
}
console.log(s.length, 'stations', ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
```

It parses attributes in any order and FAILS loudly on zero matches — a station the regex
can't parse must never silently pass.

## Camera moves

| Move | When | How |
|---|---|---|
| `flyTo` | default station→station glide | single tween, ~1150 ms, signature ease |
| `flyDive` | showcase arrivals (full-screen sites, reveals) | zoom out to ×0.34 of target, then push in; ~1750 ms total |
| `toOverview` | the `O` key; orientation beats | fit the bounding box of ALL stations + 200px pad |
| fly-through-overview **[ADD-ON]** | "look how far we've come" moments | overview tween → 480 ms hold → dive into target; fire the station intro as the camera arrives |

Keep moves tasteful. The camera serves the narrative; Prezi-style vertigo is cheap. One
spatial *flourish* per deck (an overview fly-through near the end) is usually enough.

**[ADD-ON] fly-through-overview** — not in the template; add it when one station should
arrive "via the map". Mark the station `data-fly="through-overview"`, branch in `goto()`
before the other fly checks (`if (s.el.dataset.fly === 'through-overview' && isNew) { flyThroughOverview(s); return; }`
— it owns its own intro), and add:

```js
function flyThroughOverview(s) {
  busy = true;
  const c = overviewCam();
  const target = { x: s.cx, y: s.cy, zoom: fitZoom(s) };
  animate(cam, { x: c.x, y: c.y, zoom: c.zoom, duration: 1000 * MOTION, ease: EASE, onUpdate: render,
    onComplete: () => setTimeout(() => {
      playIntro(s, true);   // fire the reveal as the camera arrives
      animate(cam, { x: target.x, y: target.y, zoom: target.zoom,
        duration: 1150 * MOTION, ease: EASE, onUpdate: render,
        onComplete: () => { busy = false; } });
    }, 480)
  });
}
```

## Navigation & input (already wired in the template)

- `→` / `Space` / `PageDown` = next · `←` / `PageUp` = prev
- `O` / `↑` = overview · `↓` / `Esc` = return to current station
- Click a rail dot to jump (dots show name tooltips on hover); click a station in overview
  to fly to it.
- `busy` flag: input is ignored while the camera is in flight — prevents tween pile-ups.
- **Deep links:** `#s5` in the URL boots at that station. Essential for rehearsal and for
  automated verification. The boot path must run the station's scene (or intro) too — the
  template handles this.
- `resize` handler refits the current station; HUD shows `current/total` + station name.

## [ADD-ON] Stations that ARE a website (full-screen showcase)

Not in the template — splice this in when the talk dives into real pages.
To "dive into" a page mid-talk, make the station a true 1920×1080 viewport holding an
iframe, then auto-scroll the page content:

```html
<section class="station site-full" id="s7" data-name="Demo site" data-x="9200" data-y="2900"
         data-fly="dive" data-scroll="6000">
  <iframe class="site-frame" src="../sites/demo/index.html"></iframe>
</section>
```

```css
.station.site-full { padding: 0; overflow: hidden; }
.site-frame { position: absolute; top: 0; left: 0; width: 1920px; height: 1080px;
              border: 0; pointer-events: none; background: #fff; }
```

```js
let siteScrollAnim = null;
function sizeSiteFrame(f) {
  try {
    const doc = f.contentDocument || f.contentWindow.document;
    if (!doc.getElementById('__deck_noscroll')) {       // hide the page's scrollbar
      const st = doc.createElement('style'); st.id = '__deck_noscroll';
      st.textContent = 'html,body{scroll-behavior:auto!important;scrollbar-width:none}' +
        'html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0;display:none}';
      (doc.head || doc.documentElement).appendChild(st);
    }
    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 1080);
    f.dataset.dist = String(Math.max(0, h - 1080));     // content scroll range
  } catch (e) { f.dataset.dist = '0'; }                  // cross-origin → no scroll
}
function stopSiteScroll() {
  if (siteScrollAnim) { try { siteScrollAnim.pause(); } catch (e) {} siteScrollAnim = null; }
  document.querySelectorAll('.site-frame').forEach(f => {
    try { f.contentWindow.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {} });
}
function runSiteScroll(s) {
  const f = s.el.querySelector('.site-frame');
  if (!f) return;
  let win; try { win = f.contentWindow; win.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { return; }
  sizeSiteFrame(f);                       // recompute now that fonts/images settled
  const dist = +f.dataset.dist || 0;
  if (dist <= 0) return;                  // the scroll IS content — runs even under reduced-motion
  const proxy = { y: 0 };
  siteScrollAnim = animate(proxy, {
    y: dist, duration: +s.el.dataset.scroll || 6000, ease: 'inOutSine',
    // behavior:'auto' beats the page's own scroll-behavior:smooth (stutter-then-snap)
    onUpdate: () => { try { win.scrollTo({ top: proxy.y, behavior: 'auto' }); } catch (e) {} }
  });
}
// Wire into the engine: at boot, attach load listeners —
//   document.querySelectorAll('.site-frame').forEach(f => f.addEventListener('load', () => sizeSiteFrame(f)));
// In goto(): call stopSiteScroll() next to the scene stops, and after the fly:
//   if (s.el.dataset.scroll && isNew) {
//     const token = cur, flyDur = (s.el.dataset.fly === 'dive') ? 1750 : 1150;
//     setTimeout(() => { if (cur === token && !overview) runSiteScroll(s); }, flyDur * MOTION + 350);
//   }
```

- Keep the iframe element at exactly **1920×1080** so the page's own `100vh` layout reads at
  real proportions. **Do NOT resize the iframe to its content height** — an iframe's
  viewport equals its element size, so the hero balloons.
- Scroll the CONTENT instead: animate a proxy `{y}` and call
  `frame.contentWindow.scrollTo({top: y, behavior: 'auto'})` per frame.
  **`behavior:'auto'` is mandatory** — it overrides the page's own
  `scroll-behavior:smooth`, which otherwise fights per-frame updates (stutter, then snap).
- Inject `scrollbar-width:none` + `scroll-behavior:auto!important` into the iframe document;
  compute scroll distance as `scrollHeight − 1080`, recompute after fonts/images settle.
  Wrap all iframe access in try/catch (cross-origin = no scroll, not a crash).
- Start the auto-scroll only after the dive lands plus a beat
  (`setTimeout(…, flyDuration + 350)`), and guard with a token so leaving the station
  cancels it.
- Same-origin only: serve the deck and the embedded sites from one local server.

## Serving & rehearsal

A deck with iframes or fetched assets needs a server (plain `file://` works only for
self-contained decks):

```bash
python -m http.server 8000 --bind 127.0.0.1   # then open /deck/index.html
```

Rehearse with deep links (`#s7`). The presenter's pocket guide: arrows advance, `O` shows
the map, dots jump.
