/* COMPONENT: iso-box (isometric primitives)
 * WHAT   : projector + box + wheel helpers for isometric scenes.
 * SPLICE : into the engine <script>, near your scene code.
 * NEEDS  : nothing (pure geometry — returns SVG point strings).
 *
 * READ THIS FIRST — isometric is for PHYSICAL space only: a factory floor, a building,
 * machines on a line, anything where real volume is the point. On an abstract diagram (a
 * process ring, a bar chart, a meter) it reads as a gimmick and fights type-driven layout.
 * Default to FLAT. Prototype the iso look on ONE station before committing a section to it.
 */

// 1 unit = 1 station px. tw/th = tile half-width/half-height, zh = height per z unit.
// Increasing a goes down-RIGHT on screen; increasing b goes down-LEFT.
function isoProjector({ ox, oy, tw = 32, th = 18, zh = 26 }) {
  return (a, b, z = 0) => [ox + (a - b) * tw, oy + (a + b) * th - z * zh];
}

const pts = arr => arr.map(p => p.join(',')).join(' ');

// A box at (a,b) of footprint w x d, base at z, height h. Returns the three VISIBLE faces as
// polygon point strings: draw left and right first, top last. Give the faces flat tones (a
// darker left, a mid right, the lightest top) — flat facets read as solid volume and avoid
// per-instance gradient ids entirely.
function isoBox(P, a, b, z, w, d, h) {
  const t = z + h;
  return {
    top:   pts([P(a, b, t), P(a + w, b, t), P(a + w, b + d, t), P(a, b + d, t)]),
    right: pts([P(a + w, b, t), P(a + w, b + d, t), P(a + w, b + d, z), P(a + w, b, z)]),
    left:  pts([P(a, b + d, t), P(a + w, b + d, t), P(a + w, b + d, z), P(a, b + d, z)]),
  };
}

/* A SPINNING iso wheel — the one that bites.
 * NEVER rotate the whole group: a foreshortened ellipse rotated about its centre tumbles,
 * and stops reading as a circle seen at an angle. Keep rim and hub STATIC outside the
 * animated group, animate ONLY the spokes, and draw the spokes on a TRUE circle scaled down
 * on one axis so they sweep the ellipse correctly.
 * General rule: animate the sub-element whose motion is real; get the projection from a
 * transform; never rotate the silhouette.
 *
 *   const w = isoWheel({ cx: 700, cy: 420, r: 30, foreshorten: 16 / 30, spokes: 6 });
 *   svg.innerHTML = w.markup;                       // rim + hub are outside .spokes
 *   animate('#' + w.id + ' .spokes', { rotate: 360, duration: 4000, ease: 'linear', loop: true });
 */
function isoWheel({ cx, cy, r = 30, foreshorten = 0.53, spokes = 6, id = 'wheel', stroke = 'var(--accent)' }) {
  const spoke = Array.from({ length: spokes }, (_, i) => {
    const th = (Math.PI * 2 * i) / spokes;
    return `<line x1="0" y1="0" x2="${(r * Math.cos(th)).toFixed(1)}" y2="${(r * Math.sin(th)).toFixed(1)}"/>`;
  }).join('');
  return {
    id,
    markup:
      `<g id="${id}" fill="none" stroke="${stroke}" stroke-width="2" transform="translate(${cx},${cy})">` +
        // STATIC silhouette: the foreshortened rim + hub never rotate.
        `<ellipse rx="${r}" ry="${(r * foreshorten).toFixed(1)}"/>` +
        `<circle r="3" fill="${stroke}"/>` +
        // TWO nested groups, and the nesting is the point: the OUTER one holds the static
        // foreshorten, the INNER one is what you rotate. Put both on one element and the CSS
        // `rotate` anime.js writes overrides the attribute scale — the spokes then sweep a
        // true circle instead of the ellipse, and the wheel looks wrong in a way that is
        // hard to see and easy to blame on the ease.
        `<g transform="scale(1,${foreshorten.toFixed(3)})">` +
          `<g class="spokes" style="transform-box:fill-box;transform-origin:center">${spoke}</g>` +
        `</g>` +
      `</g>`
  };
}
