# Components

Copy-me code, not prose. Each file is a working piece you splice into the deck's single HTML
file; the reference docs explain the WHY and link here for the HOW.

**Why files and not snippets in the docs:** a script pasted into a markdown page has to be
retyped from context to become a file. These are already files.

## Contract

Every component opens with a header block, and the header IS the documentation:

```
COMPONENT · WHAT · SPLICE (where in the single file) · NEEDS (globals it expects) · WIRE
```

- **Read the header before splicing.** `NEEDS` lists engine globals (`cam`, `MOTION`,
  `sceneRegistry`, …); a component dropped into a rewritten engine will fail on those.
- **The output is still ONE self-contained HTML file.** Splice the contents in; never add a
  `<script src>` to a component file. Splice large blobs with shell (`sed`/`cat`), not by
  reading them into context and retyping.
- **Code lives once.** If you change a component's behaviour in a deck, that deck owns the
  change. Do not fork a component into the docs.

## What is here

| Path | Use when |
|---|---|
| `verify/check.mjs` | after EVERY edit — static gates (staircase, ids, syntax, scene wiring) |
| `verify/shoot.sh` | before declaring done — still-mode screenshot per station (`DECK_SHOT=phone` / `ipad` presets) |
| `scenes/reveal.js` | a station should hold a question, then reveal the answer on the presenter's key |
| `addons/fly-through-overview.js` | one station arrives via the map (the deck's single flourish) |
| `addons/site-iframe.js` | a station IS a real website, scrolled live |
| `svg/iso-box.js` | an isometric scene of PHYSICAL space (factory, building, line) |

Directions (the `:root` token sets) deliberately stay in `references/design.md`: choosing a
direction and applying it are the same act, so splitting them would only add a round trip.
