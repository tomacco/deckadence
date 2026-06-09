# Pitfalls & Verification

Every trap here has actually bitten. Check this list before declaring a deck done.

## Traps

1. **Mid-word line breaks in headings.** Never split a heading into per-character
   inline-blocks — the browser will break lines between them ("sys/tem"). Split into LINES
   at `<br>` only (`splitLines`), then `fitHeading` shrinks the font until each line fits.

2. **Final-state flash on reveal.** If an element becomes visible and THEN its animation
   initializes, the end state flashes first. Apply initial state (`utils.set`, dashoffset
   hiding) BEFORE the element/panel is revealed. Split scenes into reset (before visible)
   and play (after).

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

## Verifying an animated deck (do this — don't ship blind)

Static screenshots fire too early for animated content. Two tiers:

**Tier 1 — structural (always):**
- Run the staircase verification script after layout changes.
- Open every station via deep link (`#sN`) in a real browser; watch the intro; press `→`
  through the whole deck once.

**Tier 2 — automated visual states (for complex scenes):** drive headless Chrome over CDP
(Node ≥ 22 has global `WebSocket`/`fetch`; no puppeteer install needed):

```
chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080
       --remote-debugging-port=9222 --user-data-dir=<UNIQUE TEMP DIR>
       "http://127.0.0.1:8000/deck/index.html#s5"
```

In the CDP script:
- `Emulation.setEmulatedMedia({features:[{name:'prefers-reduced-motion',value:'no-preference'}]})`
  then `Page.reload` — otherwise headless reports reduced-motion.
- Wait for the scene's beats (real `setTimeout`s), then `Page.captureScreenshot` at known
  timestamps; assert numerically via `Runtime.evaluate` (computed opacity, world transform,
  `getBoundingClientRect`).
- Dispatch synthetic `KeyboardEvent`s to test navigation.
- Subscribe to `Runtime.exceptionThrown` — a silent JS error usually means a dead scene.

Gotchas: navigating to a hash-only URL on an already-loaded page does NOT re-run boot — use
a fresh launch or `Page.reload`. Concurrent headless Chromes sharing a `--user-data-dir`
lock → 0-byte screenshots; use a unique temp dir per run. Screenshot output paths must be
ABSOLUTE on Windows.

**Pre-show checklist:** vendored fonts + anime.js (no network) · full keyboard pass ·
overview (`O`) looks intentional · letterbox tone correct on a non-16:9 window · deep-link
boot works on the first AND last stations · presenter knows: arrows, O, dots.
