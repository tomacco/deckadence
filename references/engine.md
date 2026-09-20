# The Engine: Camera Over a World

How the spatial deck works, from zero. The CORE engine (world, camera, fitZoom, goto,
generic intro, HUD + windowed rail, full-screen toggle, overview, dive, deep links, scene
registry, and the phone/iPad layer: swipe nav, letterbox mask, culling, rotate hint) ships
working in `template/starter.html` — copy that file as your starting point; never rebuild the engine
from scratch. Two features are **[ADD-ON]**s you splice in only when the talk needs them —
the fly-through-overview move and the full-screen site showcase. Both live as real files in
`components/addons/`, with their wiring in each file's header.

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
> bars. The `invert-hud` body class flips the viewport background so bars are dark behind
> dark stations. Tone is deliberately split out of `setHud()` into `setTone()` because it is
> VISIBLE DURING A FLY: `goto()` fires it at the camera's midpoint, not at t=0, or the bars
> wear the destination's tone while the departing station is still on screen.

> **A station reveals on ARRIVAL.** `revealStation(s)` is the single dispatch point — the
> station's scene if it has one, else the generic intro — called from the fly's `done`
> callback and from the boot deep-link path, so the two can never drift. Fired at t=0
> instead, a scene plays its opening beats to a camera still in transit.

## Timing hooks on a fly

Both camera moves take `{ mid, done }`. `mid` fires ~55% through (state changes that must
hide inside the move: tone, letterbox, anything that repaints the viewport); `done` fires on
arrival (the reveal). A same-station replay (`Esc`/`↓`) has no flight to wait for, so it sets
tone and reveals immediately. A nav token guards both callbacks, so a fly the presenter
interrupts never reveals over another station.

**If you add a custom fly, it MUST dispatch the reveal itself** (call `done`, or
`revealStation(s)` in its `onComplete`). A custom fly that early-returns past the reveal
leaves the station arriving dead — this is the single easiest way to break the engine.

`?still=1` short-circuits both moves: the camera jumps, `mid`/`done` fire synchronously, and
`playIntro` paints final states instead of animating. That mode is what makes screenshots
usable (`pitfalls.md`, Tier 1); a scene whose CSS rest state is hidden can expose an
optional `still(el)` to paint its own flat frame.

## Layout: the monotone down/right staircase

**"Next" must always move DOWN or RIGHT — never up or left.** Lay stations out as a
staircase: x and y non-decreasing in DOM order, each step either pure right or pure down.

- Grid units that work at 1920×1080: **right = +2300 px, down = +1450 px**.
- Alternate right/down steps for visual variety; consecutive rights are fine.
- Same-size stations produce no visible zoom — use `data-zoom` (e.g. `1.6` for a tighter
  crop, `0.55` for a pull-back) or a `data-fly="dive"` transition when you want depth.

**Every station insert/delete forces a re-layout of everything after it.** This is a known
recurring manual task, so it is a script, not a habit:

```bash
node components/verify/check.mjs deck/index.html    # after EVERY edit
```

It gates the staircase plus the other things that fail silently — duplicate ids, an engine
syntax error, a `data-scene` that is never registered, a `data-fly` the engine does not
handle — and exits nonzero, so it can gate a commit. It FAILS loudly on zero parsed stations:
a station the regex cannot read must never quietly pass. It cannot see layout overflow; that
needs `components/verify/shoot.sh` and your eyes.

## Long decks: sections as territories (25+ stations)

Past roughly 25 stations the plane stops being decoration and becomes the structure — the
overview should read as a map of the talk.

- **One territory per section, contiguous on the staircase.** Advance mostly DOWN within a
  territory and take one long RIGHT step between them, so zooming out shows sections as
  columns. The spatial layout then *is* the agenda.
- **Scope a section's palette with a data attribute** on the station
  (`<section class="station" data-section="2">` + `[data-section="2"]{--accent:…}`) rather
  than per-station overrides. Re-skinning a whole territory becomes one token block.
- A section with no palette of its own **inherits the previous one**. That is a fine choice
  and a bad accident — decide it on purpose, and write down that you did.
- **The HUD rail does not scale — so the engine windows it.** One dot per station would
  overflow into the HUD corners past ~25; `railWindow()` (in the template) shows a window of
  dots around the current one and tapers the ends, sized from the measured gap between the
  counter and the station name, not a hardcoded count. If you restyle `#rail`, keep the
  `.out` / `.edge` rules; the window reads dot size and gap from the computed CSS.

## Camera moves

| Move | When | How |
|---|---|---|
| `flyTo` | default station→station glide | single tween, ~1150 ms, signature ease |
| `flyDive` | showcase arrivals (full-screen sites, reveals) | zoom out to ×0.34 of target, then push in; ~1750 ms total |
| `toOverview` | the `O` key; orientation beats | fit the bounding box of ALL stations + 200px pad |
| fly-through-overview **[ADD-ON]** | "look how far we've come" moments | overview tween → 480 ms hold → dive into target; fire the station intro as the camera arrives |

Keep moves tasteful. The camera serves the narrative; Prezi-style vertigo is cheap. One
spatial *flourish* per deck (an overview fly-through near the end) is usually enough.

**[ADD-ON] fly-through-overview** — **code: `components/addons/fly-through-overview.js`**.
Add it when one station should arrive "via the map": pull out to the overview, hold 480 ms
(the hold IS the beat), then dive in. Its header carries the `goto()` wiring. Because it owns
the whole move it must dispatch the reveal and the tone flip itself — that is what the
`{ mid, done }` callbacks are for.

## Navigation & input (already wired in the template)

- `→` / `Space` / `PageDown` = next · `←` / `PageUp` = prev
- `O` / `↑` = overview · `↓` / `Esc` = return to current station · `F` = full screen
  (also the `#fsbtn` button top-right — it is ALWAYS present; on iPhone Safari, which has
  no element fullscreen, the engine hides it and flags `body.no-fullscreen`)
- Click a rail dot to jump (dots show name tooltips on hover); click a station in overview
  to fly to it.
- **Touch (phones, iPads):** a single-finger swipe is the arrow keys, through the same
  `step(dir)` dispatch — a reel that intercepts arrows intercepts swipes for free. The first
  swipe enters full screen (a gesture is required; once only — if the reader exits, respect
  it). Pinch-zoom is left to the browser; while zoomed in, swipes pan instead of navigating.
  `overscroll-behavior: none` so swipe-down is prev, not pull-to-refresh.
- `busy` flag: input is ignored while the camera is in flight — prevents tween pile-ups.
- **Deep links:** `#s5` in the URL boots at that station. Essential for rehearsal and for
  automated verification. The boot path must run the station's scene (or intro) too — the
  template handles this.
- `resize` handler refits the current station; HUD shows `current/total` + station name.

## Phones & iPads (in the template — keep it when you restyle)

Decks get read on phones after the talk, and the HUD is the first thing a redesign breaks.
What ships, and what each piece is for:

| Piece | What it does | Keep when you… |
|---|---|---|
| **Letterbox mask** `maskToStation()` | clips `#viewport` to the fitted frame at rest (open during flights) — on a 4:3 iPad or a 19.5:9 phone the bars are wide enough to show the NEIGHBOURING station otherwise | change fly functions (call `unmask()` at departure, `maskToStation()` on arrival) |
| **Culling** `updateCulling()` | on coarse pointers paints only the current station ±1 — mobile Safari kills the tab under memory pressure on long decks; next/prev only cross adjacent stations so flights still pan over painted content | add a navigation path (call it after `cur` changes) |
| **Rotate hint** `#rotatehint` | small PORTRAIT touch screens get a full-screen "rotate your phone" — a 16:9 world reads ~2.4x bigger in landscape; tap = full screen + dismiss | redesign chrome (restyle it in the direction's tokens, do not delete it) |
| **Swipe hint** `#swipehint` | one 5 s pill on first load, touch only | — |
| **Phone HUD** `@media (max-width: 760px), (max-height: 500px)` | smaller counter, 5 px dots, safe-area insets (`viewport-fit=cover` in the meta) | restyle the HUD (re-derive these rules for your HUD) |
| **Touch chrome** `@media (pointer: coarse)` | iframes `pointer-events: none` (else swipes die inside them), hover tooltip hidden, bigger + pulsing full-screen button (the only way to shed Safari's URL bar) | restyle the HUD |

Station CONTENT needs nothing: the camera fits the 1920×1080 frame, so type scales with it.
Verify with `DECK_SHOT=phone components/verify/shoot.sh deck/index.html` (844×390) and
`DECK_SHOT=ipad` (1180×820) — the mask and phone HUD only show up off-16:9 at small sizes.
`check.mjs` fails the deck if any of this chrome is missing.

## [ADD-ON] Stations that ARE a website (full-screen showcase)

**Code: `components/addons/site-iframe.js`** (markup, CSS and wiring are in its header).
Splice it in when the talk dives into real pages: the station becomes a true 1920×1080
viewport holding an iframe, and the PAGE scrolls, not the frame.

The reasons it is shaped that way, because each one was a bug:

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
