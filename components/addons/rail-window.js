/* COMPONENT: rail-window
 * WHAT   : keeps the HUD progress rail usable past ~25 stations. One dot per station
 *          eventually overflows into the HUD's corner text; this shows a window of dots
 *          around the current one and tapers the ends so the deck still reads as long.
 * SPLICE : into the engine <script>, after the rail is built (after `const dots = …`).
 * NEEDS  : hud, dots, stations
 * CSS    : #rail .dot.out  { display: none; }
 *          #rail .dot.edge { opacity: .22; transform: scale(.62); }
 * WIRE   : call railWindow(i) from setHud(i), after the .active toggle:
 *            railWindow(i);
 *          and on resize, next to the refit:
 *            railWindow(cur);
 */

// The window is sized from the ACTUAL gap between the HUD's corner elements, not a guess —
// a hardcoded dot count overlaps the key hints on a narrow window or wastes space on a wide
// one. DOT and GAP must match the #rail CSS.
function railWindow(i) {
  const DOT = 8, GAP = 10, CLEAR = 28;             // px; CLEAR = breathing room per side
  const n = dots.length;
  if (!n) return;
  // Corner text in the template: #idx on the left, .station-name on the right.
  const l = hud.querySelector('#idx'), r = hud.querySelector('.station-name');
  let avail = hud.getBoundingClientRect().width;
  if (l && r) {
    const span = r.getBoundingClientRect().left - l.getBoundingClientRect().right;
    if (span > 60) avail = span;                   // ignore a bogus measure (hidden HUD, 0 width)
  }
  const max = Math.max(5, Math.floor((avail - 2 * CLEAR) / (DOT + GAP)));
  if (n <= max) {                                   // everything fits: plain rail
    dots.forEach(d => d.classList.remove('out', 'edge'));
    return;
  }
  let start = Math.min(Math.max(0, i - Math.floor(max / 2)), n - max);
  const end = start + max - 1;                      // inclusive
  dots.forEach((d, k) => {
    const inWin = k >= start && k <= end;
    d.classList.toggle('out', !inWin);
    // Taper only the ends that actually have more stations beyond them, so the rail says
    // "there is more this way" instead of just truncating.
    d.classList.toggle('edge', inWin && ((k === start && start > 0) || (k === end && end < n - 1)));
  });
}
