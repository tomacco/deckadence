# SVG: Diagrams That Draw Themselves

Hand-authored inline SVG is the deck's superpower: diagrams, flourishes, node graphs, and
icons that *construct themselves* on screen instead of appearing as static clipart. Author
SVG directly — you are good at this; do not reach for a charting library.

## The two primitives

> Both helpers (`drawPaths`, `pulseAlong`) **already exist in `template/starter.html`**,
> wired into the scene registry and scaled by the deck's `MOTION` constant — reuse them.
> The snippets below are the reference shape for when you're building outside the template;
> if you re-implement, keep the `* MOTION` scaling or reduced-motion handling breaks.

### Stroke-draw (a path draws itself)

```js
function drawPaths(scene, paths, dur, baseDelay = 0, step = 0) {
  paths.forEach((p, i) => {
    const L = p.getTotalLength(), o = { v: L };
    p.style.strokeDasharray = L; p.style.strokeDashoffset = L;   // hidden, pre-draw
    scene.anims.push(anime.animate(o, {
      v: [L, 0], duration: dur, delay: baseDelay + i * step, ease: 'inOutQuad',
      onUpdate: () => { p.style.strokeDashoffset = o.v; }
    }));
  });
}
```

Animate a **proxy object** and set `strokeDashoffset` in `onUpdate` — do not rely on the
library tweening the CSS property directly (silent no-ops depending on build/property
handling). To pre-hide paths during a scene's reset step, set
`strokeDasharray = strokeDashoffset = getTotalLength()`.

Wrap `getTotalLength()` in try/catch when paths may not be rendered yet (returns 0 → skip).

### Pulse along a path (data flows down a wire)

```js
function pulseAlong(scene, dot, path, dur, delay = 0) {
  const L = path.getTotalLength();
  scene.timers.push(setTimeout(() => {
    if (scene.cancelled) return;
    anime.utils.set(dot, { opacity: 1 });
    const prog = { t: 0 };
    scene.anims.push(anime.animate(prog, { t: [0, 1], duration: dur, ease: 'inOutQuad',
      onUpdate: () => { const pt = path.getPointAtLength(L * prog.t);
                        dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); },
      onComplete: () => { dot.style.opacity = 0; } }));
  }, delay));
}
```

The `<circle class="pulse">` lives in the SVG next to its wire, opacity 0 at rest.

## Composition recipes

**Node graph** (pipelines, architectures, flows) — build in layers, animate in narrative
order:

1. **Canvas chrome** — dark panel, optional dot-grid (generate `<circle>`s in a loop at
   boot; ~49×45 px spacing, r=3, low opacity).
2. **Node cards** — `<g class="node">` with `rect` (rounded 10px) + centered `text`
   (`text-anchor:middle`). Inputs left, transform center, output right.
3. **Wires** — cubic béziers between edge midpoints with horizontal handles:
   `M x1 y1 C x1+110 y1, x2−110 y2, x2 y2`. Add tiny port dots at the endpoints.
4. **Pulses** — one per wire.

Sequence: inputs snap in (stagger 150 ms) → input wires draw → pulses flow in → transform
node snaps in → output wire draws → pulse → output reveals. The diagram *tells* the
causality; never reveal everything at once.

**Underline / scribble flourish** — a hand-drawn-feel `<path>` under a key word, 2–3 px
stroke, `stroke-linecap:round`, drawn over ~850 ms a beat after the word lands. One slight
wave (`C` curve with ±6 px y-wobble) reads hand-made; perfect lines read mechanical.

**Heartbeat / icon moment** — draw the icon's outline path (~900 ms), then pulse `scale`
keyframes `1→1.18→1→1.12→1` with `transform-origin:center`. Outline-draw-then-animate beats
a static icon every time.

**Replicating a real tool's UI** (when the talk shows "what tool X does"): find the PATTERN
in screenshots first — what's input, what transforms, what's output — then rebuild the
chrome (panel, node cards, title bars, port dots, wires) as clean SVG/HTML and animate the
FLOW. An animated reconstruction that explains beats a pixel-perfect static screenshot.

## Authoring rules

- **Always set explicit `width`/`height` on inline `<svg>`** — a viewBox alone renders huge
  and overflows flex/grid cells. Size the viewBox in station pixels (the 1920×1080 frame) so
  coordinates are predictable; 1 viewBox unit = 1 station px.
- Stroke everything that will draw itself; `fill:none` until drawn (or fade fill in after
  the stroke completes).
- Use the deck's CSS variables in SVG (`stroke="var(--accent)"` works on inline SVG) so the
  diagram re-skins with the design direction.
- `stroke-linecap:round; stroke-linejoin:round` for anything organic; square caps for
  technical/Swiss directions.
- Keep text as SVG `<text>` (it inherits deck fonts) unless it needs to wrap — then overlay
  HTML absolutely positioned over the SVG.
- Decorative SVGs: `aria-hidden="true"`; meaningful diagrams: a `<title>`.
- Hand-compute coordinates; round numbers (40, 160, 210) keep paths editable. When wires
  must meet node edges, derive endpoints from the rect coords — don't eyeball.
