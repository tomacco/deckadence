# The Engine: Camera Over a World

How the spatial deck works, from zero. The engine (world, camera, fitZoom, goto, generic
intro, HUD + windowed rail, full-screen toggle, overview, dive and through-overview flies, deep
links, scene registry, live window, and the phone/iPad layer: swipe nav, letterbox mask,
culling, rotate hint) is ONE shared runtime, `template/deckadence/`. A deck links it; it never
carries a copy of its own. Start from `template/starter.html`, never rebuild the engine from
scratch. The full-screen site showcase is an **[ADD-ON]** you add to the deck's own script
only when the talk needs it (`components/addons/site-iframe.js`).

## The runtime: one engine, every deck

```
deck/index.html            the design (:root tokens, type, per-station CSS), the stations, the deck's scenes
deck/deckadence/           the runtime: deckadence.css (plane, frame, masks, HUD, phone chrome)
                                        deckadence.js  (everything else)
```

- **Pinned by major.** `<html data-deckadence="2">` names the major the deck was built for. The
  runtime logs an error when it does not match, and `check.mjs` fails the deck. Within a major
  every change keeps decks working; anything that would break a deck's markup or scenes is a
  new major.
- **Installed, never edited.** `node components/runtime/install.mjs deck/index.html` copies the
  current runtime into `deck/deckadence/` (refusing another major unless `--major` says the deck
  was ported). That is how an engine fix reaches a deck without touching the deck's file;
  `--check` exits 1 when a deck's copy is stale. In this repo the landing (`docs/`) carries a
  copy for GitHub Pages and `tests/runtime.test.mjs` fails when it drifts from the template's.
- **The deck's scripts come after the runtime.** They register scenes on `Deckadence.scenes`
  (aliased `sceneRegistry`, the name `check.mjs` reads) and take what they need from
  `window.Deckadence`: `MOTION`, `EASE`, `splitLines`, `fitHeading`, `releaseClips`,
  `primeIntro`, `playIntro`, `stations`, `current()`, `step()`. The first reveal waits for
  `DOMContentLoaded`, so every scene is registered before it runs. The deck's pace is
  `<html data-pace="1.15">`.
- **Hooks, not splices.** A deck cannot reach inside the engine, so the engine offers the
  points a deck needs: a scene's `handleKey(dir)` sees every step (arrows and swipes) first and
  consumes it by returning true; `deck:mount` / `deck:unmount` / `deck:arrive` / `deck:leave`
  bubble from the station. A new kind of fly is a runtime change, not deck code.
- **One file to share.** `node components/stream/pack.mjs deck/index.html` inlines the runtime
  (and every other local script and stylesheet) into `deck/index.packed.html`, which presents
  from `file://` with nothing beside it. `--split` keeps the runtime linked: a streamed deck is
  served with its folder.
- **An older deck** (engine pasted inline, no `data-deckadence`) still works and still passes
  `check.mjs`; it just never receives a fix. To move it onto the runtime: keep its design CSS,
  its stations and its scene code; delete the engine `<script>` and the engine CSS; link the
  runtime and add the pin as the template does; open the scene code with the template's deck
  prologue; run `install.mjs`, `check.mjs` and `flash.mjs`.

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

> **…and is PRIMED at departure.** `primeStation(s)` puts everything the reveal will animate
> into its initial state (the generic intro's `primeIntro`, or the scene's `prep(el)`).
> `goto()` calls it before any fly branch, while the destination is still masked
> off-screen, so the flight shows the station empty and arrival only adds. Boot primes the
> start station in the same tick it becomes visible. Priming on arrival is the final-state
> flash (`pitfalls.md` trap 2); `revealStation` logs a `[deckadence]` warning when it gets an
> unprimed station, and `components/verify/flash.mjs` fails the deck.

## Timing hooks on a fly

Both camera moves take `{ mid, done }`. `mid` fires ~55% through (state changes that must
hide inside the move: tone, letterbox, anything that repaints the viewport); `done` fires on
arrival (the reveal). A same-station replay (`Esc`/`↓`) has no flight to wait for, so it sets
tone and reveals immediately. A nav token guards both callbacks, so a fly the presenter
interrupts never reveals over another station.

**A new fly is a runtime change (`template/deckadence/deckadence.js`), and it MUST dispatch the reveal itself** (call `done`, or
`revealStation(s)` in its `onComplete`), and it must be a branch inside `goto()` BELOW the
`primeStation(s)` line, so the station is primed before the camera moves. A custom fly that early-returns past the reveal
leaves the station arriving dead — this is the single easiest way to break the engine.

`?still=1` short-circuits every move: the camera jumps, `mid`/`done` fire synchronously, and
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
handle, duplicate or unlinkable station keys, CSS that landed on the wrong station — and
exits nonzero, so it can gate a commit. It FAILS loudly on zero parsed stations: a station
the regex cannot read must never quietly pass. It cannot see layout overflow; that needs
`components/verify/shoot.sh` and your eyes.

## Station identity: keys, not numbers

A station's `id="sN"` is **positional**: every insert and reorder renumbers it. That makes it
a poor address for a deck under iteration — the reviewer is often looking at a render from
before the last change, so "slide 3" means two different slides to the two people talking.

So every station carries a **key**, a stable name that does not move:

```html
<section class="station" id="s4" data-key="LYRA" data-name="On the map" …>
```

- **Free-form, uppercase by convention**, one fixed vocabulary per deck (stars, colours,
  animals, names). It must work as a URL fragment: letters, digits, `- _ . ~`.
- The **HUD** renders `LYRA · ON THE MAP` (the key in a `.station-key` span inside
  `.station-name`); a station without a key renders exactly as before. Rail tooltips and the
  **overview** labels (`.station-tag`, shown only while `body.is-overview`) carry it too.
- **Deep links:** `#LYRA` boots at that station (case-insensitive), as does `#s4`; editing
  the hash on a loaded deck flies there (a hash edited mid-flight waits for the landing).
  On boot and while navigating, the engine keeps the URL on the current station, **by key**
  when it has one (`#s4` becomes `#LYRA`), so a copied link survives a reorder. `?still=1`
  leaves a boot hash as given.
- **Keys are what you say out loud in review.** "LYRA's chart is too small" stays true
  across a reorder; "slide 4's chart" does not.

**The naming rule** — without it a key drifts and becomes as unreliable as a number:

1. If a slide changes enough that it is a **different slide, it gets a NEW key**. A renamed
   key signals the old version is dead, so a stale deck identifies itself.
2. **Retired keys are never reused.**
3. **Reserve keys for stations not yet built**, so parallel work cannot collide.

`check.mjs` warns on a station with no key, and FAILS on two stations sharing one, on a key
shaped like a positional id (`S3`) or equal to a station id (the id would win the deep link),
and on a key that is not a clean hash fragment.

### Scope station CSS by key, never by id

Because ids move, **a rule scoped to `#sN` breaks on reorder** — in two directions. The id
moves away and the rule silently styles nothing; or an insert hands the freed id to a
DIFFERENT station and one station's rules now style another (measured: 24 rules from one
station landing on its neighbour, which presented as an overflow on a slide whose own CSS was
fine). Scope by the key, or by a class the station carries:

```css
/* NO  */ #s4 .castor-bar            { fill: var(--accent); }
/* YES */ [data-key="CASTOR"] .castor-bar { fill: var(--accent); }
```

`[data-key]` is class-level specificity, lower than an id: if a shared rule such as
`.station.invert .eyebrow` now wins where `#s4 …` used to, raise the scoped rule to
`.station[data-key="CASTOR"] …` rather than reaching for the id again. `check.mjs` warns on
every rule scoped to a station id and FAILS a rule scoped to `#sN` whose classes only appear
inside a different station's markup (the inverted case).

Re-keying a station (the naming rule above) orphans its `[data-key="OLD"]` rules the same
way, so **move the CSS with the key**. `check.mjs` FAILS any `[data-key="X"]` selector whose
X no station carries, including a case-only mismatch: CSS attribute matching is
case-sensitive even though `#key` deep links are not.

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
  dots around the current one and tapers the ends, sized from the measured HUD width, not a
  hardcoded count. If you restyle `#rail`, keep the `.out` / `.edge` rules; the window reads
  dot size and gap from the computed CSS.
- **The HUD is a `1fr auto 1fr` grid, never a `space-between` flex row.** Equal outer columns
  pin the rail to the viewport centre, so a dot stays under the presenter's cursor from slide
  to slide; flexed, the rail slides with every change of station-name width and a click lands
  on the wrong dot. The name column ellipsizes (`min-width:0`), so long `KEY · NAME` labels
  are fine. `railWindow()` budgets the rail as the inner width minus two `column-gap`s minus
  two copies of max(counter width, a readable name minimum).

## Memory: the live window (long and photo-heavy decks)

Every station on the plane used to stay laid out, painted and decoded for the whole talk. A
68-station deck with 19 photos held ~426 MB in the renderer and ~306 MB on the GPU from the first
slide, and phones reload a tab like that. The template now keeps a **live window**: the current
station and `LIVE_SPAN` neighbours either side (2 on desktop, 1 on touch) hold their content; every
other station keeps only its frame (position, size, tone class) and waits as text. Measured on the
same deck: 255 MB renderer, 195 MB GPU, 554 DOM nodes instead of 2,588.

- **Mount runs on every approach.** `mountStation(s)` puts the content back and runs the station's
  setup: the scene's `mount(el)` and a `deck:mount` event. A scene that measures, inlines SVG or wires
  listeners does it in `mount(el)` (it may return a Promise; navigation waits for it). Code that walks
  every station ONCE at boot only sees the live ones (pitfalls.md trap 22). The first mount waits for
  `DOMContentLoaded`, so listeners in later scripts hear it too. A `mount(el)` that throws or rejects
  is reported in the console and breaks that station's setup only, never navigation. A streamed
  station that fails to load (or takes longer than 10 s) shows a note in its frame and is fetched
  again on the next approach; the camera is never held.
- **Released on arrival, never before.** `settleLive()` runs after the reveal: neighbours mounted, far
  stations released, the station you left released only once the camera no longer shows it.
- **Nothing paints before the engine.** `body:not(.deck-ready) #world { visibility: hidden }` keeps the
  browser from painting the plane while it parses (every station stacked at 0,0, every photo decoded)
  when the engine's script is late. `check.mjs` fails an engine that has the window and not this gate.
- **The overview never mounts the deck.** Dormant frames show their `data-poster` still if the deck was
  packed with posters, and the station key labels either way.
- **Opting out.** `<html data-live="all">` keeps every station mounted, for a deck whose code cannot
  move into `mount(el)`.
- **The deck is a model; the DOM is a view of a few stations.** `Deckadence.stations` are records
  (id, key, name, position, tone, poster, content source); only the live window has DOM. Anything that
  needs ALL stations works from the records and never from their DOM: the overview (posters), the
  edit-mode navigator (server-rendered posters), reorder (the edit server's source model). Edit mode
  binds a station's text when it mounts, commits an edit before its station leaves the DOM, and calls
  `setSource(i, html)` after a save so a remount shows the edit. `components/verify/memory.mjs --edit`
  measures edit mode with the navigator scrolled end to end.

### Publishing: packed and streamed decks

`node components/stream/pack.mjs deck/index.html` writes `index.packed.html`: every station's content
inside `<template data-station>`, so nothing in it is parsed, fetched or decoded until mounted. One
file, works from `file://`. Add `--split` for `index.stream.html` plus `stations/<KEY>.html`: the
page carries only the frames and the server streams each station as the camera approaches (the
engine prefetches `LIVE_SPAN + 2` ahead; a failed fetch shows a note in the frame and retries on
the next approach). `--posters` adds a small still per station for the overview. Author and edit
the source; pack to publish (edit mode refuses a packed or streamed deck). On a 26-station photo deck the authored file fetched 19 MB before the
first slide; packed and streamed fetched 0.2 MB.

`node components/verify/memory.mjs deck/index.html` walks every station in headless Chrome and
reports renderer and GPU memory, live stations, DOM nodes, bytes loaded before the first slide and
frame pacing during flights. It reads the OS (`ps`), not DevTools, so it works where remote debugging
is refused.

## Camera moves

| Move | When | How |
|---|---|---|
| `flyTo` | default station→station glide | single tween, ~1150 ms, signature ease |
| `flyDive` | showcase arrivals (full-screen sites, reveals) | zoom out to ×0.34 of target, then push in; ~1750 ms total |
| `toOverview` | the `O` key; orientation beats | fit the bounding box of ALL stations + 200px pad |
| `flyThroughOverview` | "look how far we've come" moments (`data-fly="through-overview"`) | overview tween → 480 ms hold → dive into target; the station reveals as the camera arrives |

Keep moves tasteful. The camera serves the narrative; Prezi-style vertigo is cheap. One
spatial *flourish* per deck (an overview fly-through near the end) is usually enough.

**`data-fly="through-overview"`** makes one station arrive "via the map": pull out to the
overview, hold 480 ms (the hold IS the beat), then dive in. It is a runtime fly like `dive`, so
it primes, flips tone and reveals through the same `{ mid, done }` callbacks.

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
- **Deep links:** `#LYRA` (a station key) or `#s5` (its position) in the URL boots at that
  station; changing the hash later flies there. Essential for rehearsal and for automated
  verification. Prefer the key: it survives a reorder. The boot path must run the station's scene (or intro) too — the
  template handles this.
- `resize` handler refits the current station; HUD shows `current/total` + `KEY · NAME`.

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

Rehearse with deep links (`#LYRA`, or `#s7`). The presenter's pocket guide: arrows advance, `O` shows
the map, dots jump.

## Control-layer hooks: `window.Deckadence`

The template exposes one object for layers that sit on top of the deck. Edit mode
(`references/edit.md`) is the first. It carries the camera, the stations, `goto`, the reveal
helpers (`splitLines`, `fitHeading`, `releaseClips`, `primeStation`, `revealStation`), the live window
(`mountStation`, `setLive('all')`, `isLive(i)`, `liveSpan`), `isPresenting()` and
`setInset(px)`, which shrinks the stage by a left inset (for a sidebar) and refits. A layer asks
the engine through this object. It never re-implements the camera or the reveal. A layer
that reveals a station itself calls `primeStation(s)` first, while the station is hidden. **Keep it when
you restyle or rebuild the HUD**: without it the deck still presents, but it cannot be edited.
The keydown handler also ignores keys aimed at text fields and editable elements, so typing
never navigates.
