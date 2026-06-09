# Design Direction Protocol

The engine is brand-agnostic. Every visual decision lives in the `:root` tokens of the deck
(colors, fonts, display transform/weight/tracking) plus one font import. This file tells you
how to CHOOSE those tokens.

## Step 1 — ALWAYS ask for a real design reference first

> **NON-NEGOTIABLE.** Before building anything, ask the user:
> *"Do you have a design reference I should match — a Figma, a brand file, an existing deck,
> a design system?"*

If they have one, **that reference is the contract**. Extract its type, color, spacing, and
motion personality and encode them in the tokens. Do NOT substitute your own taste or a
distillation of some website you admire. A reference site the user merely likes is NOT their
brand — confirm before treating it as one.

If the user provides a PDF/Figma export, read it before writing a single line of CSS.

## Step 2 — No reference? Derive a direction from the talk itself

Ask (or infer from the request) three things:

1. **Audience** — engineers? designers? executives? a community meetup? investors?
2. **Mood** — provocative, warm, authoritative, playful, urgent?
3. **Occasion** — conference keynote, team review, product launch, classroom?

Then pick ONE direction below, state your choice and why in one sentence, and offer to swap.
Never silently default to the same direction every time — that is exactly the
"everything looks the same" AI-slop failure this skill exists to prevent.

## The directions

Each direction is applied by swapping THREE things in the template: the listed `:root`
tokens, the font `<link>` (all fonts below are on Google Fonts), and the `PACE` constant
(the direction's motion personality). Tokens a direction doesn't list — `--line`,
`--ease-expo` — keep their template defaults unless noted.

> **Dark-first directions** (Terminal, Midnight Luxe): `--bg` is dark and `--ink` is light,
> so a plain station is dark and `.station.invert` gives you the LIGHT station — the class
> means "opposite of the canvas tone", and the letterbox logic follows automatically.
> Remember to override `--line` (the default is a black-alpha that vanishes on dark).

> **Show-day fonts:** Google Fonts is a network dependency. Before presenting, self-host:
> download the woff2 files (the URLs are inside the Google Fonts CSS response), add
> `@font-face` rules next to the tokens, and delete the `<link>`.

### 1. Brutalist Grotesk — bold claims, tech talks, manifestos
Heavy caps, edge-to-edge, monochrome with a violent accent. Confident to the point of rude.
```css
--bg:#EFEDEA; --ink:#000; --ink-soft:#191919; --muted:#9CA3AF; --accent:#7c3aed;
--font-display:"Archivo Black",sans-serif; --font-body:"Archivo",sans-serif;
--display-transform:uppercase; --display-weight:900; --display-tracking:-.01em;
```
Motion: weighty line-rise, hard contrast inversions, fast cuts between beats.

### 2. Editorial Serif — storytelling, strategy, founder narratives
Expressive serif display over warm paper. Reads like a magazine cover per station.
```css
--bg:#F7F3EC; --ink:#1A1714; --ink-soft:#3D3833; --muted:#A39B8F; --accent:#B0402A;
--font-display:"Fraunces",serif; --font-body:"Inter",sans-serif;
--display-transform:none; --display-weight:600; --display-tracking:-.03em;
```
Motion: slower, softer line-rise (`PACE = 1.15`); italic `<em>` accents; generous holds.

### 3. Terminal — security, infra, dev tooling, anything that ships in a shell
Mono everything, phosphor accent on near-black. Cursor-blink energy.
```css
--bg:#0C0E0C; --ink:#D8E3D6; --ink-soft:#A9B8A6; --muted:#5C6B5A; --accent:#4ADE80;
--line:rgba(216,227,214,.16);
--font-display:"JetBrains Mono",monospace; --font-body:"JetBrains Mono",monospace;
--display-transform:uppercase; --display-weight:800; --display-tracking:0;
```
Dark-first: use `.station.invert` for the light stations. Motion: typewriter/step reveals
read well here; keep line-rise snappy (`PACE = 0.85`).

### 4. Swiss — data, corporate, quarterly truth-telling
Grid discipline, one red, no decoration. Information is the aesthetic.
```css
--bg:#FFFFFF; --ink:#111; --ink-soft:#333; --muted:#999; --accent:#E10600;
--font-display:"Inter Tight",sans-serif; --font-body:"Inter",sans-serif;
--display-transform:none; --display-weight:700; --display-tracking:-.04em;
```
Motion: restrained — fades and small rises only; let layout changes be the drama.

### 5. Playful Pop — community talks, design meetups, workshops
Rounded type, candy palette, bounce in the easing. Joy is allowed.
```css
--bg:#FFF7EE; --ink:#27224F; --ink-soft:#4A4470; --muted:#A9A3C7; --accent:#FF5D8F;
--font-display:"Bricolage Grotesque",sans-serif; --font-body:"Bricolage Grotesque",sans-serif;
--display-transform:none; --display-weight:800; --display-tracking:-.02em;
```
Motion: `ease:'out(4)'` springs, slight scale overshoots, staggered confetti-like fades.
Still ONE accent per station — but rotate WHICH accent station-by-station from a fixed
candy set (#FF5D8F, #FFB13D, #3DDC97, #5B8DEF), so the deck stays playful without any
single moment losing its focus.

### 6. Midnight Luxe — product launches, premium reveals, finales
Near-black velvet, one metallic accent, serif display. Decadent, cinematic.
```css
--bg:#0D0C0B; --ink:#F4F1EA; --ink-soft:#C9C4B8; --muted:#6E695F; --accent:#E8C46B;
--line:rgba(244,241,234,.14);
--font-display:"Fraunces",serif; --font-body:"Inter",sans-serif;
--display-transform:none; --display-weight:500; --display-tracking:-.02em;
```
Dark-first: use `.station.invert` for the light stations (and darken the gold accent on
them — metallics wash out on ivory). Motion: slow (`PACE = 1.25`), long holds, gold SVG
stroke-draws as the signature flourish.

## Rules that hold in EVERY direction

- **One accent color, used deliberately.** If everything is accented, nothing is.
- **Never pure white `#FFFFFF` as canvas** unless the direction demands it (Swiss does);
  warm paper tones read better on projectors.
- **Contrast inversion is a rhythm device.** Flip a station to the opposite tone to mark a
  beat change or a key claim — never at random, never twice in a row without a reason.
- **The letterbox must follow the station's tone** (the `dark-hud` body class in the
  template). Light bars behind a dark station read as a bug.
- **Type bleeds edge-to-edge.** Big type comes from fitting the 1920×1080 frame to the
  viewport, not from pushing font-size until it overflows.
- **Spacing on an 8px baseline.** Generous negative space; one idea per station.
- **Match motion personality to the direction** (noted per direction above). The signature
  ease `cubic-bezier(.82,0,.18,1)` is the default; soften or snap it per mood.
- **Projector check:** if presenting on an unknown projector, avoid mid-gray-on-gray
  (< 40% luminance difference) — cheap projectors crush it.
