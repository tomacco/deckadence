/* COMPONENT: fly-through-overview
 * WHAT   : one station arrives "via the map" — pull out to the overview, hold, then dive in.
 *          The deck's one spatial flourish. Use ONCE, usually near the end.
 * SPLICE : into the engine <script>, next to flyTo / flyDive.
 * NEEDS  : cam, render, animate, EASE, MOTION, fitZoom, overviewCam, busy
 * WIRE   : mark the station data-fly="through-overview", then in goto(), BEFORE the other
 *          fly checks (it owns the whole move):
 *            if (s.el.dataset.fly === 'through-overview') {
 *              flyThroughOverview(s, { mid, done: reveal }); return;
 *            }
 * WHY the callbacks: a custom fly MUST dispatch the reveal itself (`done`) or the station
 *          arrives dead, and MUST flip tone via `mid` while the map hides it.
 *          See references/pitfalls.md traps 13 and 14.
 */
function flyThroughOverview(s, { mid, done } = {}) {
  busy = true;
  const c = overviewCam();
  const target = { x: s.cx, y: s.cy, zoom: fitZoom(s) };
  animate(cam, {
    x: c.x, y: c.y, zoom: c.zoom, duration: 1000 * MOTION, ease: EASE, onUpdate: render,
    onComplete: () => setTimeout(() => {
      if (mid) mid();                       // tone flips while the map is on screen
      animate(cam, {
        x: target.x, y: target.y, zoom: target.zoom,
        duration: 1150 * MOTION, ease: EASE, onUpdate: render,
        onComplete: () => { busy = false; if (done) done(); }
      });
    }, 480)                                 // the hold IS the beat — do not shorten it
  });
}
