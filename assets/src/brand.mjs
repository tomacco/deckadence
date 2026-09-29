// Regenerates the brand SVGs: assets/banner.svg, banner-dark.svg, mark.svg, mark-dark.svg and
// docs/favicon.svg. Text is OUTLINED because an SVG shown through <img> (GitHub READMEs) cannot
// load web fonts.
//
//   fonts: put these next to this script (all SIL OFL):
//     Newsreader72pt-Light.ttf, Newsreader72pt-LightItalic.ttf  (github.com/productiontype/Newsreader, fonts/static/ttf)
//     Inter-Regular.ttf, Inter-Medium.ttf, Inter-SemiBold.ttf    (github.com/rsms/inter releases, extras/ttf)
//   run:   bun add opentype.js && bun assets/src/brand.mjs .      (from the repo root)
import opentype from 'opentype.js';
import { writeFileSync, readFileSync } from 'node:fs';
const dir = import.meta.dir;
const load = f => { const b = readFileSync(f); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const F = {
  serif:  load(`${dir}/Newsreader72pt-Light.ttf`),
  italic: load(`${dir}/Newsreader72pt-LightItalic.ttf`),
  sans:   load(`${dir}/Inter-Regular.ttf`),
  sansMd: load(`${dir}/Inter-Medium.ttf`),
  sansSb: load(`${dir}/Inter-SemiBold.ttf`),
};
const r = n => Math.round(n * 100) / 100;
// Lay out a string with kerning + tracking (em); returns { d, width }.
function text(font, str, x, y, size, { track = 0, upper = false } = {}) {
  if (upper) str = str.toUpperCase();
  const glyphs = [...str].map(ch => font.charToGlyph(ch)), scale = size / font.unitsPerEm;
  let cx = x, d = '';
  glyphs.forEach((g, i) => {
    const p = g.getPath(cx, y, size);
    // own serializer: opentype's toPathData(decimals) emits "NaN" for some coordinates
    for (const c of p.commands) {
      const n = v => (Math.round(v * 100) / 100).toString();
      if (c.type === 'M' || c.type === 'L') d += c.type + n(c.x) + ' ' + n(c.y);
      else if (c.type === 'Q') d += 'Q' + n(c.x1) + ' ' + n(c.y1) + ' ' + n(c.x) + ' ' + n(c.y);
      else if (c.type === 'C') d += 'C' + n(c.x1) + ' ' + n(c.y1) + ' ' + n(c.x2) + ' ' + n(c.y2) + ' ' + n(c.x) + ' ' + n(c.y);
      else if (c.type === 'Z') d += 'Z';
    }
    cx += g.advanceWidth * scale + track * size;
    if (i < glyphs.length - 1) { const k = font.getKerningValue(g, glyphs[i + 1]); if (Number.isFinite(k)) cx += k * scale; }
  });
  return { d, width: cx - x - track * size };
}
const P = (t, fill, extra = '') => `<path d="${t.d}" fill="${fill}"${extra}/>`;

const THEMES = {
  light: { bg: '#F3F0E9', ink: '#151412', soft: '#3B3833', muted: '#8E887D', line: 'rgba(21,20,18,.18)', red: '#C8102E' },
  dark:  { bg: '#121110', ink: '#EFEBE3', soft: '#C4BEB3', muted: '#857F74', line: 'rgba(239,235,227,.22)', red: '#D4213D' },
};

/* ---------- banner (1600 × 500) ---------- */
function banner(t, animated = true) {
  const W = 1600, H = 500, X = 112;
  const eyebrow = text(F.sansSb, 'A skill for Claude Code', X + 4, 142, 15, { track: .3, upper: true });
  const word = text(F.serif, 'Deckadence', X, 322, 196, { track: -.03 });
  const dotR = 196 * .075, dotX = X + word.width + dotR + 6, dotY = 322 - dotR;
  const motto = text(F.italic, 'The room goes quiet.', X + 4, 404, 54);
  // wall label, bottom right
  const LX = 1196, LY = 346;
  const l1 = text(F.sansSb, 'Deckadence', LX, LY, 17);
  const l2 = text(F.italic, 'The room goes quiet', LX, LY + 30, 20);
  const l2b = text(F.sans, ', 2026', LX + l2.width, LY + 30, 17);
  const l3 = text(F.sans, 'HTML, SVG and motion on one plane', LX, LY + 58, 17);
  const l4 = text(F.sans, '1920 × 1080, a single file', LX, LY + 86, 17);
  // study: three frames and the camera path between them, top right
  const fr = [[1196, 150], [1316, 84], [1436, 128]].map(([x, y]) => ({ x, y, w: 104, h: 58 }));
  const c = f => [f.x + f.w / 2, f.y + f.h / 2];
  const [a, b, e] = fr.map(c);
  const path = `M ${a[0]} ${a[1]} C ${a[0] + 40} ${a[1]}, ${b[0] - 50} ${b[1]}, ${b[0]} ${b[1]} S ${e[0] - 40} ${e[1]}, ${e[0]} ${e[1]}`;
  const css = animated ? `
    <style>
      .draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.8s cubic-bezier(.65,0,.35,1) forwards; }
      .f1 { animation-delay: .2s } .f2 { animation-delay: 1.05s } .f3 { animation-delay: 1.9s } .cam { animation-duration: 2.2s; animation-delay: .55s }
      .fade { opacity: 0; animation: fade 1.4s ease forwards; }
      .motto { animation-delay: .9s } .lab { animation-delay: 2.4s }
      .dot { transform-box: fill-box; transform-origin: center; transform: scale(0); animation: pop .7s cubic-bezier(.34,1.56,.64,1) 1.6s forwards; }
      .walker { opacity: 0; animation: fade .3s ease .5s forwards; }
      @keyframes draw { to { stroke-dashoffset: 0 } }
      @keyframes fade { to { opacity: 1 } }
      @keyframes pop  { to { transform: scale(1) } }
      @media (prefers-reduced-motion: reduce) { .draw, .fade, .dot, .walker { animation-duration: .01s; animation-delay: 0s; } }
    </style>` : '';
  const pl = 'pathLength="1"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Deckadence. The room goes quiet. A skill for Claude Code.">
  <title>Deckadence. The room goes quiet.</title>${css}
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${P(eyebrow, t.muted)}
  ${P(word, t.ink)}
  <circle class="dot" cx="${r(dotX)}" cy="${r(dotY)}" r="${r(dotR)}" fill="${t.red}"/>
  <g class="fade motto">${P(motto, t.soft)}</g>
  <g fill="none" stroke="${t.ink}" stroke-width="1.5" opacity=".7">
    ${fr.map((f, i) => `<rect class="draw f${i + 1}" ${pl} x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2"/>`).join('\n    ')}
    <path class="draw cam" ${pl} d="${path}" stroke-width="1.2" opacity=".75"/>
  </g>
  ${animated ? `<circle class="walker" r="5" fill="${t.ink}">
    <animateMotion dur="2.2s" begin=".55s" fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".65 0 .35 1" path="${path}"/>
  </circle>` : `<circle r="5" fill="${t.ink}" cx="${e[0]}" cy="${e[1]}"/>`}
  <g class="fade lab">
    <line x1="${LX - 20}" y1="${LY - 22}" x2="${LX - 20}" y2="${LY + 94}" stroke="${t.line}" stroke-width="1.5"/>
    ${P(l1, t.ink)}${P(l2, t.soft)}${P(l2b, t.soft)}${P(l3, t.soft)}${P(l4, t.soft)}
  </g>
</svg>
`;
}

/* ---------- mark: "D." (square) ---------- */
function mark(t, size = 512, { bg = true, pad = .2 } = {}) {
  const fs = size * .86;
  const D = text(F.serif, 'D', 0, 0, fs);
  const bb = F.serif.charToGlyph('D').getBoundingBox(), sc = fs / F.serif.unitsPerEm;
  const dotR = fs * .075, gap = fs * .03;
  const w = (bb.x2 - bb.x1) * sc + gap + dotR * 2, h = (bb.y2 - bb.y1) * sc;
  const ox = (size - w) / 2 - bb.x1 * sc, base = (size + h) / 2;
  const D2 = text(F.serif, 'D', ox, base, fs);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Deckadence">
  ${bg ? `<rect width="${size}" height="${size}" rx="${size * .18}" fill="${t.bg}"/>` : ''}
  <path d="${D2.d}" fill="${t.ink}" stroke="${t.ink}" stroke-width="${size * .012}"/>
  <circle cx="${r(ox + bb.x2 * sc + gap + dotR)}" cy="${r(base - dotR)}" r="${r(dotR)}" fill="${t.red}"/>
</svg>
`;
}

const out = process.argv[2];
writeFileSync(`${out}/assets/banner.svg`, banner(THEMES.light));
writeFileSync(`${out}/assets/banner-dark.svg`, banner(THEMES.dark));

writeFileSync(`${out}/assets/mark.svg`, mark(THEMES.light));
writeFileSync(`${out}/assets/mark-dark.svg`, mark(THEMES.dark));
writeFileSync(`${out}/docs/favicon.svg`, mark(THEMES.dark, 64));
console.log('ok');
