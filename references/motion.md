# Motion: Reveals, Scenes, Choreography

Animation craft for the deck. anime.js v4 UMD — named exports live on the global:
`anime.animate`, `anime.stagger`, `anime.utils`.

> **Ease gotcha (silent failure).** Named ease STRINGS work: `'out(3)'`, `'inOutQuad'`,
> `'inOutSine'`. But the string `'cubicBezier(.82,0,.18,1)'` was REMOVED from anime.js v4 —
> it silently falls back to LINEAR with only a console warning. Always use the function:
> `const EASE = anime.cubicBezier(.82, 0, .18, 1)` (the template does this). If your
> motion feels flat and mechanical, check the console for ease warnings first.

## The laws

1. **Every station gets a transition on arrival — even subtle.** No bare cuts. "Subtle" may
   be a fast quiet move; the rule is *never nothing*, not *always spectacle*.
2. **ONE element owns each moment.** Per station, one element gets the motion, the
   saturation, the glow; everything else stays calm or dims. If two things pulse, neither is
   the focus.
3. **Motion is content, not decoration.** Never gate scene/scroll/dive animations on
   `prefers-reduced-motion` — headless Chrome and OS "animations off" report `reduce`, and a
   dead cut kills the talk. Scale durations down (×0.6) instead.
4. **Set initial state BEFORE the element is visible.** See reset/play below — the #1 source
   of visual bugs.

## The generic intro (free for every station)

`playIntro()` in the template handles any station without a bespoke scene:

- Elements marked `data-split="lines"` (big display headings) get the **weighty line-rise**:
  each line rises from `translateY:100%` inside an `overflow:hidden` mask, staggered 150 ms,
  on the signature ease `cubic-bezier(.82,0,.18,1)`, ~1150 ms.
- Elements marked `data-fade` fade-up calmly (opacity 0→1, y 22→0, stagger 110 ms), starting
  ~440 ms after the lines so the heading clearly leads.
- A station with no marked elements auto-fades its direct children — the "never nothing"
  fallback.

**Line-rise rules (hardened by bugs):**

- **Split headings into LINES at explicit `<br>` — NEVER into characters.** Wrapping chars
  in inline-blocks lets the browser break words mid-word ("sys/tem"). Per-char is also the
  wrong *feel* for editorial/brutalist type: whole-line rise reads weighty, per-char reads
  playful.
- If you must split chars anyway (a deliberate playful direction), walk DOM `childNodes` and
  preserve inline elements — a naive `.split('')` shreds `<em>` tags into literal text.
- `fitHeading()` shrinks font-size until each `<br>` line fits one visual line — author
  line breaks by meaning, let the code fit them.
- Release the `.clip` masks after landing (`releaseClips`) so descenders (g, y, p) and
  italic overhang are never cropped at rest.

## Scene controllers (bespoke animated stations)

When a station needs choreography beyond the generic intro — diagrams that build, reels that
cycle, multi-beat sequences — register a **scene**:

```js
let myScene = null;
sceneRegistry.myname = {
  stop() {
    if (!myScene) return;
    myScene.cancelled = true;
    myScene.timers.forEach(clearTimeout);
    myScene.anims.forEach(a => { try { a.pause(); } catch (e) {} });
    myScene = null;
  },
  run(el) {
    sceneRegistry.myname.stop();
    const scene = { cancelled: false, timers: [], anims: [] };
    myScene = scene;
    // 1. RESET: apply every element's initial state NOW, before anything shows
    // 2. PLAY: an async IIFE sequences the beats
    (async () => {
      await wait(scene, 600); if (scene.cancelled) return;
      // ...each beat: animate, then `await wait(...); if (scene.cancelled) return;`
    })();
  }
};
```

Opt the station in with `data-scene="myname"`. The template's `goto()` stops **every**
registered scene on **every** navigation (cancel-on-leave) and runs the new station's scene
instead of the generic intro; the boot deep-link path does the same. Scenes therefore replay
fresh on re-entry and never leak timers.

> **The reset/play split is a HARD RULE.** If a panel becomes visible and THEN its animation
> resets and plays, the audience sees the final state flash for a frame before it animates.
> Apply initial state (`utils.set`, dashoffset hiding, opacity 0) BEFORE the reveal beat;
> never rely on an animation's first frame to hide its end state.

## One-knob speed control

To retime a whole scene, wrap every tween in a helper that scales `duration` and numeric
`delay` by one constant:

```js
const SPEED = 0.55;   // 1 = authored pace; 0.55 = 45% faster
function sA(scene, target, params) {
  const q = { ...params };
  if (typeof q.duration === 'number') q.duration *= SPEED;
  if (typeof q.delay === 'number') q.delay *= SPEED;
  const a = anime.animate(target, q); scene.anims.push(a); return a;
}
// and make wait() multiply by SPEED too
```

Author at a comfortable pace, then tune the single constant during rehearsal. Scale
durations rather than reaching for the animation object's `.speed` property — one constant
in one place is auditable. Note `stagger(...)` object delays are not scaled — acceptable.
(For the WHOLE DECK's pace, use the template's `PACE` constant instead — that's the design
direction's knob; `SPEED` here is per-scene.)

## Auto-play reel with presenter takeover

For a station that cycles through sub-beats (a concept reel, a feature tour):

- Scene holds `idx`, `seq[]`, `manual`, `autoTimer`.
- `advance(dir, isAuto)`: if `!isAuto`, set `manual = true` — the presenter took control, so
  stop scheduling auto steps. Schedule the next auto step only `if (!scene.manual)`.
- **At the end, auto STOPS on the last beat. It does NOT loop.** A looping reel upstages the
  speaker. Manual advance past the end → `next()` (leave the station); manual back before
  the first → `prev()`.
- The global keydown handler must intercept arrows while the scene is active and past its
  intro, routing them to `advance()` instead of station navigation (the template's keydown
  handler has a marked hook point). Skeleton:

```js
function advance(scene, dir, isAuto) {
  if (scene.cancelled) return;
  if (!isAuto) { scene.manual = true; clearTimeout(scene.autoTimer); }
  const n = scene.idx + dir;
  if (n >= scene.seq.length) { if (!isAuto) next(); return; }   // past the end: auto STOPS, manual leaves
  if (n < 0) { if (!isAuto) prev(); return; }
  scene.idx = n;
  showBeat(scene, scene.seq[n]);                                 // reset(beat) then play(scene, beat)
  if (!scene.manual && n < scene.seq.length - 1)
    scene.autoTimer = setTimeout(() => advance(scene, 1, true), BEAT_MS);
}
// in the keydown handler, BEFORE next()/prev():
//   if (reelScene && !reelScene.cancelled && reelScene.titleDone) {
//     advance(reelScene, e.key === 'ArrowLeft' ? -1 : 1, false); return;
//   }
```

## Choreography vocabulary

| Intent | Recipe |
|---|---|
| Weighty arrival | `translateY ['100%','0%']`, 1000–1200 ms, `cubicBezier(.82,0,.18,1)` |
| Calm support | `opacity [0,1]` + `translateY [22,0]`, 900 ms, `'out(2)'` |
| Snap-in (nodes, cards) | `opacity [0,1]` + `scale [.94,1]`, ~520 ms, `'out(3)'` |
| Emphasis pulse | keyframes `scale 1→1.18→1→1.12→1`, `'inOutSine'` |
| Hold | `await wait(scene, ms)` — silence is a beat; don't fear 600–900 ms holds |
| Breathing glow | text-shadow/opacity ramp on a 2.4 s `'inOutSine'` alternate loop — for the ONE focus element only |
| Cycling sets (palettes, examples) | swap the WHOLE row as a curated cohesive set — never flip members independently (incoherent frames) |

Stagger is your rhythm section: 150 ms between heading lines, 110 ms between fades, 300+ ms
between major reveals. When several items enter, stagger them; simultaneous arrivals read as
a glitch.
