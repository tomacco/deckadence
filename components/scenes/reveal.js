/* COMPONENT: reveal (presenter-beat reveal) — ONE scene, N stations
 * WHAT   : the tension reveal. Arriving, the station shows only its heading; the presenter's
 *          first → reveals the payload; the next → moves on. Award winners, answers to a
 *          posed question, the number behind a claim.
 * SPLICE : into the engine <script>, next to the other scenes.
 * NEEDS  : sceneRegistry, stations, cur, animate, utils, MOTION, playIntro
 * MARKUP : <section class="station" id="s9" data-name="The answer" data-scene="reveal"
 *            data-x="…" data-y="…">
 *            <h2 class="display d-l" data-split="lines">The question</h2>
 *            <div class="payload">…the reveal…</div>
 *          </section>
 *          Use NO data-fly — the default pan already dispatches run() on arrival.
 * WIRE   : in the keydown handler, BEFORE next()/prev():
 *            const sc = sceneRegistry[stations[cur].el.dataset.scene || ''];
 *            if (sc && sc.handleKey && sc.handleKey(e.key === 'ArrowLeft' ? -1 : 1)) {
 *              e.preventDefault(); return;
 *            }
 * WHY one scene for many stations: handleKey returning true/false is the whole contract —
 *          true consumes the keypress (reveal), false lets the engine navigate. Every
 *          instance then behaves identically through one code path.
 */
sceneRegistry.reveal = {
  stop() { /* nothing to freeze: the reveal is a one-shot tween, not a loop */ },

  run(el) {
    const pay = el.querySelectorAll('.payload');
    el.dataset.shown = '';                       // re-arm on every arrival AND on replay
    if (pay.length) utils.set(pay, { opacity: 0, translateY: 26 });
    playIntro({ el }, true);                     // the heading gets the normal line-rise
  },

  // ?still=1 must show the FULL station — a screenshot of beat 0 hides the payload's layout.
  still(el) {
    const pay = el.querySelectorAll('.payload');
    if (pay.length) utils.set(pay, { opacity: 1, translateY: 0 });
    el.dataset.shown = '1';
  },

  handleKey(dir) {
    const el = stations[cur].el;
    if (dir > 0 && !el.dataset.shown) {
      el.dataset.shown = '1';
      const pay = el.querySelectorAll('.payload');
      if (pay.length) animate(pay, {
        opacity: [0, 1], translateY: [26, 0], duration: 620 * MOTION,
        delay: anime.stagger(90 * MOTION), ease: 'out(3)'
      });
      return true;                               // consume: this → was the reveal
    }
    return false;                                // anything else: navigate as normal
  }
};
