# Edit Mode: a control layer for the human

A deck is authored as HTML, which suits the agent and is slow for a human making a small change.
Edit mode is an opt-in layer over a **served** deck: the human edits text in place, leaves
comments for the agent, decides on the agent's proposals and reorders stations. Every action is
written to disk, because the agent cannot see the browser. Anything that only exists in the DOM
does not exist for the model.

```bash
node components/edit/serve.mjs deck/index.html            # bun works too
#   present  http://127.0.0.1:4800/index.html
#   edit     http://127.0.0.1:4800/index.html?edit=1   (or Ctrl+Shift+E / ⌘⇧E)
```

## The contract

| Rule | How it holds |
|---|---|
| OFF by default | Only `?edit=1` or the chord `Ctrl+Shift+E` (`⌘⇧E`) turns it on. No single key does. |
| Never during a presentation | Full screen turns edit mode off, and the chord is refused while presenting. `?still=1` never loads it. |
| Edits land in the source | `serve.mjs` splices the change into the HTML file at exact byte offsets. Nothing is re-serialised, so a one-word edit is a one-word diff. |
| One sidecar per deck | `deck/index.review.json` holds the edits, comments, replies and decisions. It is plain JSON, next to the deck. |
| The deck file stays clean | The server injects `edit.js`/`edit.css` on the wire. `file://`, GitHub Pages and `python -m http.server` serve the deck exactly as before. |
| The engine stays the owner | The layer drives the camera and reveals through `window.Deckadence` (see below) and never re-implements either. |

## What the human gets

The toolbar is the black pill at the top. A vermilion hairline around the stage means edit mode is on.

- **Text · `T`**: click a heading, eyebrow or body line and type. `Enter` adds a line to a
  heading (`<br>` is how a heading sets its line count) and commits a body line. `Shift+Enter`
  always adds a line. `Esc` cancels. Clicking away saves.
  - Only text and line breaks are editable. If a change would drop an `.accent` span, add
    formatting, or let the browser insert a `<div>`, the server **refuses** it (422) and the
    text reverts. Classes and data attributes are what the engine reads.
  - Headings are edited on their ORIGINAL markup, never on the `.lineInner` split output. After
    a save the heading is re-split and re-fitted from scratch. `fitHeading` only ever shrinks,
    so its old size is cleared first.
  - If the file changed underneath (the agent edited it), the save is refused (409) and the
    latest text is reloaded. Nothing is clobbered.
- **Comment · `C`**: click anywhere on a station and write to the agent. The pin records the
  station, the point in the 1920×1080 frame, and a stable selector for the element under the
  click (plus its text and a relative offset), so the pin follows its element through a layout
  change. Pins are hidden whenever edit mode is off. Resolving a comment keeps it in the file
  (`resolved: true`). `R` shows resolved pins.
- **Decisions**: when the agent attaches a proposal to a reply, the thread shows **Apply
  change**, **Keep as is** and **Something else…** (with a note). The decision is written to
  the sidecar. If the proposal carries a `patch`, Apply also writes it into the deck at once.
  The toolbar counts open comments, and a red `needs you` flags proposals that are waiting on
  the human. Click it to jump from one to the next.
- **Slides · `N`**: a sidebar of thumbnails. Each one is the deck itself in flat mode
  (`?still=1`), so it shows final states and never catches a station mid-animation. The stage
  shrinks to make room. Drag a slide to reorder it, or use `Alt+↑/↓` on a focused slide.

## Reordering: slots, not renumbering

The staircase is treated as **slots**. Slot *k* sits at slot *k−1* plus the step (pure right
or pure down) it had before. A reorder moves stations between slots and rewrites every
`data-x`/`data-y`, so the map keeps its shape and `check.mjs` keeps passing. **Ids never
change.** The order IS the DOM order, so `#sN` deep links and id-scoped CSS survive the move.
A comment directly above a station travels with that station. The relayout lives once, in
`components/edit/source.mjs` (`reorder`, `relayout`), and is not rewritten in each deck.

## The agent's side

The agent reads the sidecar from disk, with no browser and no screenshot:

```bash
node components/edit/review.mjs deck/index.html          # open comments, decisions, recent edits
node components/edit/review.mjs deck/index.html --json   # the same, for parsing
```

Answer a comment by piping JSON in on STDIN. Prose never goes through a shell argument.

```bash
node components/edit/review.mjs deck/index.html reply c3 <<'JSON'
{ "text": "Agreed, it reads as two claims.",
  "proposal": { "summary": "Cut the heading to one line",
                "patch": { "find": "Invert contrast<br>to mark a turn", "replace": "Invert to turn" } } }
JSON
node components/edit/review.mjs deck/index.html resolve c3
```

- `patch.find` must match the station's source **exactly and once**. Add `"station"` to target
  a station other than the comment's. Without a patch, Apply means "yes, do it", and the agent
  makes the change on its next turn.
- A reply appears in the open browser live: the server watches the sidecar. If the agent edits
  the deck itself, the page reloads on the same station, with edit mode still on.
- On its next turn, the agent runs `status` first. `decision.choice` is `apply`, `keep` or
  `other` (with `text`). `applied: false` + `error` means the patch no longer matched. Re-read
  the station and propose again.

### Sidecar format (`deckadence-review/1`)

```jsonc
{ "format": "deckadence-review/1", "deck": "index.html",
  "comments": [{ "id": "c1", "station": "s3", "at": { "x": 169, "y": 243 },
    "anchor": { "selector": "#s3 > div.eyebrow", "text": "Beat change", "offset": { "x": 0.3, "y": 0.5 } },
    "text": "Eyebrow is redundant here", "author": "Ivan", "created": "…", "resolved": false,
    "replies": [{ "id": "c1.r1", "role": "agent", "author": "Claude", "created": "…", "text": "…",
      "proposal": { "summary": "…", "patch": { "find": "…", "replace": "…" } },
      "decision": { "choice": "apply", "by": "Ivan", "at": "…", "applied": true } }] }],
  "edits": [{ "id": "e1", "kind": "text", "station": "s3", "key": "s3:1", "selector": "#s3 > h2.display",
              "before": "…", "after": "…", "author": "Ivan", "at": "…" },
            { "id": "e2", "kind": "reorder", "before": ["s1","s2","s3"], "after": ["s1","s3","s2"], … }] }
```

## Engine hooks: `window.Deckadence`

The template exposes one surface for control layers:
`cam`, `stations`, `world`, `viewport`, `current()`, `isBusy()`, `isOverview()`, `still`, `goto(i)`,
`toOverview()`, `render()`, `fitZoom(s)`, `revealStation(s)`, `splitLines(el)`, `fitHeading(el)`,
`releaseClips(el)`, `setInset(px)` (the stage becomes the window minus a left inset) and
`isPresenting()`. The engine's keydown handler also ignores keys aimed at a text field or an
editable element, so typing a space never advances the deck.

**Keep these hooks when you rebuild the HUD or restyle the engine.** A deck without them still
presents; it just cannot be edited (`check.mjs` notes it). A deck built from an older template
needs these hooks spliced in before edit mode can work on it.

## Traps this layer already steps around

- **The browser scrolls `overflow:hidden`.** A caret near the frame's edge scrolls `#viewport`
  to reveal it and shifts the whole stage off the camera. The layer pins that scroll at 0.
- **`contenteditable` inside a scaled world.** In Chrome, caret placement by click, typing,
  line breaks and selection work at the fitted zoom, so the camera is NOT pinned 1:1 while
  editing. Safari and Firefox are untested. If one of them misbehaves, pinning the camera at 1:1
  is the fallback.
- **Keys go to the right owner.** Keys inside the layer's panels stop while bubbling, so the
  field still gets them and the deck never does. Buttons blur after a click, so the arrow keys
  keep navigating.
