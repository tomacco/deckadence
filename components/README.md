# Components

Copy-me code, not prose. Each file is a working piece you splice into the deck's own script
(the one after the runtime); the reference docs explain the WHY and link here for the HOW.

**Why files and not snippets in the docs:** a script pasted into a markdown page has to be
retyped from context to become a file. These are already files.

## Contract

Every component opens with a header block, and the header IS the documentation:

```
COMPONENT · WHAT · SPLICE (where in the deck) · NEEDS (what it takes from window.Deckadence) · WIRE
```

- **Read the header before splicing.** `NEEDS` lists what the component takes from the
  runtime (`window.Deckadence`: `MOTION`, `scenes`, `current()`, …). The engine itself is the
  shared runtime (`runtime/install.mjs`): never splice into it, never paste a copy into a deck.
- **The deck stays one file plus its runtime folder**, and `stream/pack.mjs` makes it ONE file.
  Splice a component's contents in; never add a `<script src>` to a component file. Splice
  large blobs with shell (`sed`/`cat`), not by reading them into context and retyping.
- **Code lives once.** If you change a component's behaviour in a deck, that deck owns the
  change. Do not fork a component into the docs.

## What is here

| Path | Use when |
|---|---|
| `verify/check.mjs` | after EVERY edit — static gates (staircase, ids, station keys, id-scoped CSS, syntax, scene wiring, flash guard) |
| `verify/shoot.sh` | before declaring done — still-mode screenshot per station (`DECK_SHOT=phone` / `ipad` presets) |
| `verify/flash.mjs` | before declaring done — walks the deck in a real browser and fails on the final-state flash (pitfalls trap 2) |
| `scenes/reveal.js` | a station should hold a question, then reveal the answer on the presenter's key |
| `runtime/install.mjs` | a new deck, or an engine fix to pick up: copies the shared runtime beside the deck (`--check`: is it current?) |
| `addons/site-iframe.js` | a station IS a real website, scrolled live |
| `svg/iso-box.js` | an isometric scene of PHYSICAL space (factory, building, line) |
| `edit/` | **not spliced**: the edit-mode dev server (`serve.mjs`), the layer it injects (`edit.js`, `edit.css`), the agent CLI (`review.mjs`) and the source/sidecar modules. See `references/edit.md` |

Directions (the `:root` token sets) deliberately stay in `references/design.md`: choosing a
direction and applying it are the same act, so splitting them would only add a round trip.
