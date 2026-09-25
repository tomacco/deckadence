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
world/camera/render, fitted 1920×1080 stations, HUD rail (windowed past ~25 stations),
keyboard nav, a full-screen toggle (button + `F`), overview, deep links, the generic intro
(line-rise + fades), one example scene (SVG stroke-draw + pulse), and the **phone/iPad
layer**: swipe nav, letterbox mask, station culling, rotate hint, safe-area HUD. **Modify
the template; never rebuild the engine from scratch, and never strip the chrome** — the
static gate (`check.mjs`) fails a deck that lost it.
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

While drafting, mark unresolved placeholders and open TODOs with a **highlighter background**
(a `.todo` class) so returning to the deck makes them impossible to miss. Never let a
placeholder look like finished copy.

### 5 · Verify by LOOKING, then hand over

**Never declare a deck done that you have not seen rendered.** Serve it, screenshot every
station with `?still=1#<id>`, and read the images — that flat mode exists because an animated
station shot mid-rise photographs as an empty frame and hides every layout bug. Then run the
static gates and walk the deck with arrow keys for the motion. Full recipe and what headless
can NOT tell you: `references/pitfalls.md`.

Tell the user: arrows/Space navigate, `O` = overview, `F` = full screen, dots jump, `#sN`
deep-links, swipe on phones/iPads, and to **vendor anime.js locally before show day**.

### 6 · Review loop (edit mode)

For the human to change the deck themselves, serve it with `node components/edit/serve.mjs
deck/index.html` and send them the `?edit=1` link. They edit text in place, pin comments,
and drag stations into a new order. All of it lands in the HTML and in
`deck/index.review.json`. **At the start of every turn while a review is open, run
`node components/edit/review.mjs deck/index.html`**, act on it, and answer each comment with a
reply (attach a `patch` so their Apply button makes the change). Full loop:
`references/edit.md`. Keep `window.Deckadence` when you restyle the engine; edit mode needs it.

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
11. **A station reveals on ARRIVAL, never at departure** — and any custom fly you add must
    dispatch that reveal itself, or the station arrives dead.
12. **Never ship a deck you have not looked at.** `?still=1` + a screenshot per station.
13. **Every deck is phone- and iPad-friendly out of the box.** The full-screen button,
    swipe nav, letterbox mask, culling, rotate hint and phone HUD ship in the template and
    stay in: keep `#fsbtn`/`#rotatehint` when you redesign the HUD, keep the `(pointer:
    coarse)` and phone-size media queries when you restyle, and shoot the `phone` preset
    before declaring done. Decks get read on phones after the talk.

## Reference map (read on demand)

| File | Read when |
|---|---|
| `references/design.md` | choosing/applying a design direction (ALWAYS at step 0) |
| `references/engine.md` | touching layout, camera, navigation, iframes, station coords |
| `references/motion.md` | building reveals, bespoke scenes, reels, timing |
| `references/svg.md` | any diagram, flourish, node graph, or icon moment |
| `references/pitfalls.md` | before declaring done; debugging weirdness; verification |
| `references/edit.md` | the human wants to edit, comment on or reorder a deck in the browser; answering their comments |
| `components/README.md` | the splice contract, if a component's own header is not enough |

## Components (copy-me code, not prose — splice into the single file)

Each file's header carries its own WHAT / SPLICE / NEEDS / WIRE. Read the one you need.

| Component | Reach for it when |
|---|---|
| `components/verify/check.mjs` | after EVERY edit — static gates, exits nonzero |
| `components/verify/shoot.sh` | before declaring done — a still screenshot per station (`DECK_SHOT=phone` too) |
| `components/scenes/reveal.js` | a station holds a question, then reveals on the presenter's key |
| `components/addons/fly-through-overview.js` | one station should arrive via the map |
| `components/addons/site-iframe.js` | a station IS a real website, scrolled live |
| `components/svg/iso-box.js` | an isometric scene of PHYSICAL space (factory, building, line) |
| `components/edit/serve.mjs` | the human wants to edit the deck themselves: serves it with edit mode (`?edit=1`) |
| `components/edit/review.mjs` | read the human's comments, edits and decisions from the sidecar; reply with proposals |
