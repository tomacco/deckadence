---
name: deckadence
description: 'Build indulgently animated, single-file HTML presentations — a spatial camera-over-a-world deck engine with cinematic transitions, choreographed reveals, and self-drawing SVG diagrams. Use when the user wants slides, a talk deck, a presentation, a keynote, or to present/pitch something — especially "like a Prezi", "animated slides", or "HTML slides". Works from zero — no framework, no build step, one HTML file.'
---

# Deckadence

You are building a **single self-contained HTML file** that is a full presentation: stations
(slides) placed on an infinite 2D plane, a virtual camera that flies between them, and
choreographed animations driven by **anime.js v4**. No framework, no build step. The result
should feel like a title sequence, not a slideshow.

## Workflow

### 0 · Design direction — BEFORE any code

Ask the user: **"Do you have a design reference I should match — a Figma, brand file, or
existing deck?"** If yes, that reference is the contract; extract tokens from it. If no,
choose a direction from `references/design.md` based on audience, mood, and occasion —
state your pick in one sentence and offer to swap. Never default to the same look twice;
the whole point is decks that DON'T all look the same.

### 1 · Start from the template

Copy `template/starter.html` (next to this file) into the user's project — `deck/index.html`
is a good default — and set its `<title>`. It contains the complete working engine:
world/camera/render, fitted 1920×1080 stations, HUD rail, keyboard nav, overview, deep
links, the generic intro (line-rise + fades), and one example scene (SVG stroke-draw +
pulse). **Modify the template; never rebuild the engine from scratch.**
Re-skin = swap the `:root` token block, the font `<link>`, and the `PACE` constant —
nothing else. Tokens a direction doesn't list (e.g. `--line`, `--ease-expo`) keep their
template defaults.

### 2 · Structure the narrative

One idea per station. Map the talk's beats to stations first (titles only), get the user's
sign-off on the sequence, then build. Use contrast inversion (light↔dark stations) to mark
beat changes. Plan ONE spatial flourish (overview fly-through or dive) — not ten.

### 3 · Lay out the staircase

Stations advance DOWN or RIGHT only (monotone staircase; right = +2300, down = +1450).
After every insert/delete, re-run the verification script in `references/engine.md`.

### 4 · Animate

The generic intro covers most stations free: mark headings `data-split="lines"`, supporting
elements `data-fade`. For hero moments, build a bespoke scene (registry pattern) — see
`references/motion.md`. Diagrams should draw themselves — see `references/svg.md`.

### 5 · Verify, then hand over

Walk the full deck with arrow keys, check every station via deep link, run the staircase
script. For complex scenes use the CDP harness in `references/pitfalls.md`. Tell the user:
arrows/Space navigate, `O` = overview, dots jump, `#sN` deep-links, and to **vendor
anime.js locally before show day**.

## Hard rules (each one earned the hard way)

1. **Every station gets a transition** — even subtle. Never a bare cut.
2. **One element owns each moment.** If two things pulse, neither is the focus.
3. **Split headings into LINES, never characters** — char-splitting breaks words mid-word.
4. **Set initial state BEFORE elements are visible** (reset/play split) — or the final
   state flashes on reveal.
5. **Never override a station's `position`** — it must stay `position:absolute`.
6. **Motion is content**: under `prefers-reduced-motion`, scale durations down — never cut
   animations entirely.
7. **Auto-playing reels STOP at the end** (presenter can step with arrows); they never loop.
8. **Fit the frame to the viewport** — big type comes from the camera fitting the 16:9
   frame edge-to-edge, not from font-size inflation.
9. **The letterbox follows the station's tone** (`invert-hud` body class) — light bars
   behind a dark station read as a bug. `.station.invert` means "opposite of the canvas
   tone": the dark station on a light direction, the light one on a dark-first direction.
10. **One accent color per station, used deliberately.**

## Reference map (read on demand)

| File | Read when |
|---|---|
| `references/design.md` | choosing/applying a design direction (ALWAYS at step 0) |
| `references/engine.md` | touching layout, camera, navigation, iframes, station coords |
| `references/motion.md` | building reveals, bespoke scenes, reels, timing |
| `references/svg.md` | any diagram, flourish, node graph, or icon moment |
| `references/pitfalls.md` | before declaring done; debugging weirdness; verification |
