# Pitfalls & Verification

Every trap here has actually bitten. Check this list before declaring a deck done.

## Traps

1. **Mid-word line breaks in headings.** Never split a heading into per-character
   inline-blocks — the browser will break lines between them ("sys/tem"). Split into LINES
   at `<br>` only (`splitLines`), then `fitHeading` shrinks the font until each line fits.

2. **Final-state flash on reveal.** The most-reported bug, and it came back more than once
   because it looked like a per-scene mistake when it was an ENGINE one. The camera shows
   the destination while it flies there; if the station's initial state (lines below their
   mask, opacity 0, paths undrawn, typed text cleared) is applied on ARRIVAL, the audience
   sees it finished for most of a second, then empty, then animating back in. Resetting
   carefully inside `run()` cannot fix it: `run()` itself fires on arrival (trap 13).
   **The fix is structural:** `goto()` calls `primeStation(s)` at DEPARTURE, while the
   destination is still masked off-screen; it primes the generic intro (`primeIntro`) or
   calls the scene's **`prep(el)`**, which holds EVERY initial state the scene animates
   from. `run()` and `playIntro()` only play. Boot primes the start station in the same tick
   it becomes visible. A reveal that arrives unprimed (a custom fly outside `goto()`) logs
   `[deckadence] station revealed without priming`. Gates: `check.mjs` fails a missing
   `primeStation` call or a scene without `prep`; `flash.mjs` walks the deck in a browser and
   fails on any element seen visible, then hidden, during one visit (measured before this
   fix: 10 of 10 visits flashed on the starter template, 14 of 14 on the landing).

3. **Station `position` override.** A `.station` must stay `position:absolute`. A layout
   class setting `position:relative` sends content off-screen.

4. **Staircase violations.** After ANY station insert/delete/reorder, re-run the monotone
   staircase check (script in `engine.md`). A single backward step makes one transition
   move up/left and the spatial story collapses.

5. **Inline `<svg>` without explicit width/height** renders huge and overflows flex/grid
   cells. Always set both.

6. **Full-screen iframe ballooning.** Never resize an iframe to its content height — its
   viewport equals its element size, so the page's `100vh` hero balloons. Keep it 1920×1080
   and scroll the content via `contentWindow.scrollTo`.

7. **`scrollTo` vs `scroll-behavior:smooth`.** Per-frame scripted scrolling must pass
   `{behavior:'auto'}` or the page's own smooth-scroll CSS fights it (stutter, then snap).

8. **Reduced-motion kills the show.** OS "animations off" and headless Chrome report
   `prefers-reduced-motion: reduce`. Motion is content: scale durations (×0.6), never gate
   scenes/dives/scrolls behind `!reduceMotion`.

9. **CDN dependency on show day.** Vendor anime.js next to the deck before presenting.
   Conference wifi is not a dependency.

10. **Scene leaks.** Every scene needs a `stop()` wired into `goto()` (the registry handles
    this) — otherwise timers from a left station fire over the next one. Async sequences
    must check `if (scene.cancelled) return` after EVERY await.

11. **Fonts loading late.** Anything measuring text (`fitHeading`, scroll distances,
    `getTotalLength` on text-adjacent paths) should run after `document.fonts.ready` or
    after a settle delay; recompute scroll distances on a second pass.

12. **A heading that clips its cap-tops ONCE on a cold load.** Fingerprint: it happens on
    the first visit with an empty cache and never again. That is a font race, NOT an
    overflow or line-height bug — do not chase it as geometry. The line-rise wraps each
    line in an `overflow:hidden` mask; if the display font is `font-display:swap` and not
    preloaded it can swap in MID-rise, and the taller cap metrics clip against the
    still-closing mask for a frame. Once cached the intro never coincides with a swap
    again. **Any mask-then-reveal must run at FINAL font metrics:** the template gates the
    first reveal on `document.fonts.ready`; preload the display face so that gate resolves
    instantly instead of delaying the open.

13. **Revealing at departure instead of arrival.** Dispatching a station's scene or intro
    at the START of the fly means its opening beats play to a camera still in transit — on
    a 1750 ms `dive`, most of the choreography happens while the audience is watching from
    across the plane. The template reveals in the fly's `done` callback
    (`revealStation`); a same-station replay reveals immediately because there is no
    flight to wait for. Reveal on arrival, but PRIME at departure (trap 2): the two halves
    are separate calls, and swapping either one brings a bug back. **Any custom fly you add must dispatch the reveal itself** or the
    station arrives dead.

14. **State that flips mid-transition.** The letterbox bars paint the viewport background
    and the HUD ink flips with them, so toggling tone at t=0 repaints to the DESTINATION
    tone while the station being LEFT is still on screen. Time any visible state change to
    the point where the move HIDES it (the template's `mid` callback, ~55% through), not to
    where the transition begins. This is an ordering bug, and it looks exactly like a
    missing-remask bug — do not fix it by adding masks.

15. **`stop()` must FREEZE, not dispose.** Scenes are stopped at the start of a navigation,
    and the station being left stays on screen for the whole fly (and in the overview). A
    `stop()` that disposes, `removeChild`s, or force-loses a WebGL context makes the
    content VANISH mid-transition. Freeze on leave (cancel timers, pause tweens, keep the
    last frame painted); do the real teardown at the top of `run()` on re-entry, so at most
    one heavyweight context exists at a time.
16. **A HUD redesign that drops the phone chrome.** The deck looks perfect on the desktop
    it was built on, and on a phone the full-screen button is gone, swipes do nothing, the
    neighbouring station peeks through the letterbox bars, and 30 dots overflow the HUD.
    Every one of these was fixed once and lost once. `#fsbtn`, `#rotatehint`, the
    `(pointer: coarse)` block, the phone-size media query and `railWindow` / `maskToStation`
    / `updateCulling` are engine, not decoration — `check.mjs` fails a deck without them.
17. **iPhone Safari has no element fullscreen** (iPad and Android do). `requestFullscreen`
    is undefined there; the engine hides the button and sets `body.no-fullscreen` so copy can
    offer the honest path (Share → Add to Home Screen). Do not "fix" the missing button.
18. **Swipes die inside iframes.** A live-site station with an interactive iframe eats the
    touch; the reader is stuck. The `(pointer: coarse)` block sets `pointer-events: none`
    on station iframes — keep it, and on phones prefer a pre-rendered still to a live site
    (memory: live iframes are what kills the tab).
19. **Station CSS scoped by `#sN` breaks on reorder.** Station ids are positional; a reorder
    renumbers them. Every rule scoped to the old id silently stops matching and the station
    renders unstyled — no gate sees it, because markup and CSS are both still valid. Worse,
    it inverts: an insert hands the freed id to a DIFFERENT station, and one station's rules
    now style its neighbour (measured on a 13 station deck: 24 rules pointing at the wrong
    station, presenting as content overflowing a slide whose own CSS was fine). Do not chase
    that as an overflow bug. **Scope station CSS by `[data-key="…"]` or a class the station
    carries, never by its id.** `check.mjs` warns on every `#sN`-scoped rule and FAILS one
    whose classes only exist in another station's markup.
20. **Addressing slides by number in review.** "Slide 3" means two different slides to two
    people looking at renders from either side of a reorder, and the fix lands on the wrong
    slide. Say the station KEY (`LYRA`), shown in the HUD. A slide that became a different
    slide gets a new key; retired keys are never reused (`engine.md`, Station identity).

21. **Rail dots that drift between slides.** A HUD laid out as a `space-between` flex row puts
    the rail wherever the (per-slide) station name leaves it — the same pixel becomes a
    different dot on the next slide. Keep the `1fr auto 1fr` grid. To verify, step through
    every station and compare each dot's CENTRE (`getBoundingClientRect` left + width/2) —
    not the span of rail ink: the active dot's `scale(1.35)` widens its own box by a pixel
    or two, and a span measurement reports that as drift.

## Verifying an animated deck (do this — don't ship blind)

**Never declare a visual artifact done without having SEEN it.** Layout bugs — overflowing
text, colliding labels, misaligned SVG — are invisible in source and obvious in a
screenshot. Three tiers, cheapest first.

**Tier 0 — static gates (no browser, after every edit):**

```bash
node components/verify/check.mjs deck/index.html
```

Staircase · duplicate ids · station keys (missing = WARN; duplicate, `sN`-shaped or not a
clean hash fragment = FAIL) · engine syntax · `data-scene` registered · `data-fly` handled ·
device chrome · CSS scoped to a station id (WARN; FAIL when it lands on another station) ·
`[data-key]` selectors naming no station (FAIL — a re-key orphans them) · unstyled classes. Exits nonzero on any FAIL, so it can gate a commit; WARN lines do not. What it cannot do is arithmetic on
your layout: sum a station's content heights against the usable frame height yourself — a
station that overflows 1080 px is a guaranteed visual bug findable without a browser.

**Tier 1 — still-mode screenshots (the workhorse).** A headless screenshot of an animated
station lands mid-rise and photographs as an EMPTY frame, so it "passes" while hiding every
layout bug. Shoot with **`?still=1`** — the template's flat mode: camera jumps, no entrance
animation, every element painted at its final state.

```bash
components/verify/shoot.sh deck/index.html          # every station -> deck/.shots/<id>.png
components/verify/shoot.sh deck/index.html s3 s7    # just these two
```

It serves the deck on a free port, discovers the station ids, shoots each one, and copies the
PNGs back for you to READ. Gitignore `.shots/`. The rules it encodes, if you ever drive the
browser by hand:

- Use `--run-all-compositor-stages-before-draw`, **not** `--virtual-time-budget` — the
  latter shoots before a late external stylesheet applies (blank white frame) and hangs on
  an endless `requestAnimationFrame` loop. A blank frame is a load race: retry once.
- **Unique `--user-data-dir` per run.** Concurrent headless browsers sharing one lock
  produce 0-byte screenshots.
- Shoot a **non-16:9 window** (1600×1000) on purpose — that is the only way letterbox bars
  appear, and mismatched bars are a real bug (trap 14).
- The browser **exits nonzero even on success**: poll for a non-empty output file, never
  trust the exit code. Wrap in `timeout`. One shot per invocation.
- Under WSL, a Windows browser binary needs a **Windows** output path — write into
  `%LOCALAPPDATA%\Temp` and copy the PNG back into Linux to read it. Killing strays with
  `pkill -f msedge` also matches the invoking script's own command line; match on
  `msedge.exe --headless` instead.
- Shoot by **station id** (`#s3`) or, better, **key** (`#LYRA`), never by index — indices
  shift on every insert, and ids with them; keys do not.
- Shoot the **`DECK_SHOT=phone`** preset (844×390) as well: the letterbox mask, the windowed
  rail and the phone-size HUD only exist at that size, and a HUD that overflows a phone is
  invisible in a 1600×1000 shot. `ipad` (1180×820) for the 4:3 case.

**Tier 1.5 — the flash probe (every deck, before done):**

```bash
node components/verify/flash.mjs deck/index.html
```

Walks every station forward then back in headless Chrome and samples the destination on
every animation frame, from departure to 1.5 s after arrival. It fails when an element is
seen visible (opacity, inside its line mask, stroke drawn, on screen) and later hidden in
the same visit, when typed text is cleared, or when the engine logs a `[deckadence]` flash
warning. Blinking elements (infinite CSS animations) are skipped. This is trap 2's
detector: a still shot cannot show a transition, and a 100 ms interval sampler misses it.

**Tier 2 — CDP for MOTION (only when the timing itself is the question):** still mode
cannot verify choreography. Drive the browser over CDP (Node ≥ 22 has global
`WebSocket`/`fetch`; no puppeteer install needed) with `--remote-debugging-port=9222`, then:
- `Emulation.setEmulatedMedia({features:[{name:'prefers-reduced-motion',value:'no-preference'}]})`
  then `Page.reload` — otherwise headless reports reduced-motion.
- Wait for the scene's beats (real `setTimeout`s), then `Page.captureScreenshot` at known
  timestamps; assert numerically via `Runtime.evaluate` (computed opacity, world transform,
  `getBoundingClientRect`).
- Dispatch synthetic `KeyboardEvent`s to test navigation.
- Subscribe to `Runtime.exceptionThrown` — a silent JS error usually means a dead scene.

Gotchas: navigating to a hash-only URL on an already-loaded page does NOT re-run boot — the
template's `hashchange` handler flies there instead (animated, and ignored while `busy`); for
a clean boot-path test use a fresh launch or `Page.reload`. Screenshot output paths must be ABSOLUTE.

**What headless CANNOT tell you** — do not read these as defects, and do not "fix" them:
a presenter-stepped station correctly renders as heading-only at rest; transitions and
per-beat reveals cannot be advanced or captured; live WebGL is unreliable. Verify motion,
beats, and WebGL in a real browser, live.

**Pre-show checklist:** vendored fonts + anime.js (no network) · full keyboard pass ·
overview (`O`) looks intentional · letterbox tone correct on a non-16:9 window · full-screen
button present and `F` works · deep-link boot works on the first AND last stations (by key) · every
station shot in `?still=1` and LOOKED at, desktop AND `phone` preset · `check.mjs` reports
"device chrome intact" · presenter knows: arrows, O, F, dots; readers know: swipe.
