---
name: deckadence
description: 'Build single-file HTML presentations with considered, cinematic motion — a spatial camera-over-a-world deck engine with choreographed reveals and self-drawing SVG diagrams. Use when the user wants slides, a talk deck, a presentation, a keynote, or to present/pitch something — especially "like a Prezi", "animated slides", or "HTML slides". Works from zero — no framework, no build step, one HTML file.'
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
is a good default — set its `<title>`, then install the engine beside it:
`node components/runtime/install.mjs deck/index.html` (it creates `deck/deckadence/`). The
engine is a shared, versioned runtime, not code in the deck: world/camera/render, fitted
1920×1080 stations, HUD rail (windowed past ~25 stations), keyboard nav, a full-screen toggle
(button + `F`), overview, deep links, the generic intro (line-rise + fades), the live window,
and the **phone/iPad layer**: swipe nav, letterbox mask, station culling, rotate hint,
safe-area HUD. The deck file holds the design, the stations and its own scenes (the template
ships one: SVG stroke-draw + pulse). **Never edit `deckadence/` in a deck, never paste an
engine into it, and never strip the HUD markup** — the static gate (`check.mjs`) fails a deck
that lost it. An engine fix reaches the deck by running `install.mjs` again.
Re-skin = swap the `:root` token block, the font `<link>`, and `data-pace` on `<html>` —
nothing else. Tokens a direction doesn't list (e.g. `--line`, `--ease-expo`) keep their
template defaults. To share ONE file (mail, USB), `node components/stream/pack.mjs
deck/index.html` writes `deck/index.packed.html` with the runtime inlined.

### 2 · Structure the narrative

One idea per station. Map the talk's beats to stations first (titles only), get the user's
sign-off on the sequence, then build. Use contrast inversion (light↔dark stations) to mark
beat changes. Plan ONE spatial flourish (overview fly-through or dive) — not ten.

**Give every station a KEY** (`data-key="LYRA"`) as you map it: a stable name from one fixed
vocabulary (stars, colours, animals — the scheme matters less than the stability). Ids
(`s1`, `s2` …) are positions and change on every insert and reorder; keys never do. The HUD
shows `KEY · NAME`, `#LYRA` deep-links, and **keys, not numbers, are what you and the user
say out loud in review** — "fix LYRA" still means the same slide after a reorder, while
"fix slide 3" does not. The naming rule:

- A slide that changes enough to be a **different slide gets a NEW key**. A renamed key then
  signals the old version is dead, so a stale render identifies itself.
- **Retired keys are never reused.**
- **Reserve keys for stations not yet built**, so parallel work cannot collide.

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
station with `?still=1#<id>` (or `#<KEY>`), and read the images — that flat mode exists because an animated
station shot mid-rise photographs as an empty frame and hides every layout bug. Then run the
static gates, run the **flash probe** (`node components/verify/flash.mjs deck/index.html`: it
walks the deck in a real browser and fails if anything is drawn finished, then hidden and
replayed), and walk the deck with arrow keys for the motion. Full recipe and what headless
can NOT tell you: `references/pitfalls.md`.

Tell the user: arrows/Space navigate, `O` = overview, `F` = full screen, dots jump, `#KEY`
(or `#sN`) deep-links, swipe on phones/iPads, and to **vendor anime.js locally before show day**.

### 6 · Review loop (edit mode)

For the human to change the deck themselves, serve it with `node components/edit/serve.mjs
deck/index.html` and send them the `?edit=1` link. They edit text in place, pin comments,
and drag stations into a new order. All of it lands in the HTML and in
`deck/index.review.json`. **At the start of every turn while a review is open, run
`node components/edit/review.mjs deck/index.html`**, act on it, and answer each comment with a
reply (attach a `patch` so their Apply button makes the change). Full loop:
`references/edit.md`. Edit mode drives the deck through `window.Deckadence`, which the runtime provides.

## Hard rules (each one earned the hard way)

1. **Every station gets a transition** — even subtle. Never a bare cut.
2. **One element owns each moment.** If two things pulse, neither is the focus.
3. **Split headings into LINES, never characters** — char-splitting breaks words mid-word.
4. **Prime at departure, play on arrival.** The camera shows the destination DURING the
   flight, so its initial (hidden) state must be set before the flight starts: `goto()`
   calls `primeStation()`, and every scene puts its initial state in **`prep(el)`**, never in
   `run()`. A reset on arrival is the final-state flash: the audience sees the station
   finished, then empty, then animating back in. `check.mjs` fails a scene without `prep`;
   `flash.mjs` catches the flash itself.
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
    dispatch that reveal itself, or the station arrives dead. (It is PRIMED at departure:
    rule 4. Add a fly as a branch inside `goto()`, below `primeStation(s)`.)
12. **Never ship a deck you have not looked at.** `?still=1` + a screenshot per station.
13. **Every deck is phone- and iPad-friendly out of the box.** The full-screen button,
    swipe nav, letterbox mask, culling, rotate hint and phone HUD ship in the template and
    stay in: keep `#fsbtn`/`#rotatehint` when you redesign the HUD, keep the `(pointer:
    coarse)` and phone-size media queries when you restyle, and shoot the `phone` preset
    before declaring done. Decks get read on phones after the talk.
14. **Scope station CSS by key or class, NEVER by `#sN`.** Ids are positional: a reorder
    renumbers them, and `#s4 .bar` silently styles nothing, or styles whichever station
    inherited the number. Write `[data-key="LYRA"] .bar` (or a class the station carries).
    `check.mjs` warns on any `#sN`-scoped rule and fails one that lands on another station.
15. **Per-station setup lives in the scene's `mount(el)`.** Only the stations near the camera
    are in the DOM (the live window); the rest come back from their markup on approach. Work
    done once over all stations at boot is lost. Pack a long deck to publish it
    (`components/stream/pack.mjs`), and check it with `components/verify/memory.mjs`.

## Reference map (read on demand)

| File | Read when |
|---|---|
| `references/design.md` | choosing/applying a design direction (ALWAYS at step 0) |
| `references/engine.md` | touching layout, camera, navigation, iframes, station coords |
| `references/motion.md` | building reveals, bespoke scenes, reels, timing |
| `references/svg.md` | any diagram, flourish, node graph, or icon moment |
| `references/pitfalls.md` | before declaring done; debugging weirdness; verification |
| `references/edit.md` | the human wants to edit, comment on or reorder a deck in the browser; answering their comments |
| `components/README.md` | the component contract, if a component's own header is not enough |

## Components (copy-me code, not prose — splice into the deck's own script)

Each file's header carries its own WHAT / SPLICE / NEEDS / WIRE. Read the one you need.

| Component | Reach for it when |
|---|---|
| `components/verify/check.mjs` | after EVERY edit — static gates, exits nonzero |
| `components/verify/shoot.sh` | before declaring done — a still screenshot per station (`DECK_SHOT=phone` too) |
| `components/verify/flash.mjs` | before declaring done, and after touching ANY scene or fly — fails on the final-state flash |
| `components/verify/memory.mjs` | a long or photo-heavy deck: memory, live stations and load per station, without DevTools |
| `components/stream/pack.mjs` | publishing: stations load on demand (`--split` streams them from the server, `--posters` for the overview) |
| `components/scenes/reveal.js` | a station holds a question, then reveals on the presenter's key |
| `components/runtime/install.mjs` | a new deck, or an engine fix to pick up (`--check` says whether a deck is current) |
| `components/addons/site-iframe.js` | a station IS a real website, scrolled live |
| `components/svg/iso-box.js` | an isometric scene of PHYSICAL space (factory, building, line) |
| `components/edit/serve.mjs` | the human wants to edit the deck themselves: serves it with edit mode (`?edit=1`) |
| `components/edit/review.mjs` | read the human's comments, edits and decisions from the sidecar; reply with proposals |
