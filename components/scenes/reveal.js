/* COMPONENT: reveal (presenter-beat reveal) — ONE scene, N stations
 * WHAT   : the tension reveal. Arriving, the station shows only its heading; the presenter's
 *          first → reveals the payload; the next → moves on. Award winners, answers to a
 *          posed question, the number behind a claim.
 * SPLICE : into the deck's own <script> (after the runtime), next to its other scenes.
 * NEEDS  : the prologue the template's deck script opens with, plus
 *            const { stations, current, primeIntro, playIntro } = Deckadence;
 * MARKUP : <section class="station" id="s9" data-name="The answer" data-scene="reveal"
 *            data-x="…" data-y="…">
 *            <h2 class="display d-l" data-split="lines">The question</h2>
 *            <div class="payload">…the reveal…</div>
 *          </section>
 *          Use NO data-fly — the default pan already dispatches run() on arrival.
 * WIRE   : nothing. The runtime's step() (arrows and swipes) offers every step to the current
 *          scene's handleKey(dir) first.
 * WHY one scene for many stations: handleKey returning true/false is the whole contract —
 *          true consumes the keypress (reveal), false lets the engine navigate. Every
 *          instance then behaves identically through one code path.
 */
sceneRegistry.reveal = {
  stop() { /* nothing to freeze: the reveal is a one-shot tween, not a loop */ },

  // PREP: the engine calls this at DEPARTURE (primeStation), before the camera shows the
  // station. Initial states go here, never in run(): hiding on arrival is the final-state flash.
  prep(el) {
    const pay = el.querySelectorAll('.payload');
    el.dataset.shown = '';                       // re-arm on every arrival AND on replay
    if (pay.length) utils.set(pay, { opacity: 0, translateY: 26 });
    primeIntro(el);                              // the heading's lines, parked below their mask
  },

  run(el) {
    playIntro(el);                               // the heading gets the normal line-rise
  },

  // ?still=1 must show the FULL station — a screenshot of beat 0 hides the payload's layout.
  still(el) {
    const pay = el.querySelectorAll('.payload');
    if (pay.length) utils.set(pay, { opacity: 1, translateY: 0 });
    el.dataset.shown = '1';
  },

  handleKey(dir) {
    const el = stations[current()].el;
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
