#!/usr/bin/env node
// pack.mjs — publish a deck so stations load on demand. Zero dependencies.
//
//   node components/stream/pack.mjs deck/index.html            → deck/index.packed.html
//   node components/stream/pack.mjs deck/index.html --split    → deck/index.stream.html + deck/stations/*.html
//   … [--posters] [--out <file>]
//
// WHAT  · The engine keeps only the stations near the camera in the DOM (template/starter.html, "live
//         window"). An AUTHORED deck still ships every station's markup in the file, so the browser
//         parses all of it and fetches every image it names on load. Packing removes that cost:
//           default  · each station's content goes inside <template data-station>. One file, works
//                      offline and from file://; nothing in a template is parsed into the page, fetched
//                      or decoded until the engine mounts that station.
//           --split  · each station's content goes to stations/<KEY>.html and the station gets
//                      data-src. The page carries only the frames; the server streams each station as
//                      the camera approaches (the engine prefetches a few ahead). Needs http(s): a
//                      browser will not fetch fragments from file://.
//           --posters· a small still of every station (posters/<KEY>.png, via headless Chrome) set as
//                      data-poster, so the overview shows the deck without mounting all of it.
// RULES · The source deck is never modified: author and edit (edit mode) the source, pack to publish.
//         Station markup moves byte-for-byte (components/edit/source.mjs offsets), nothing re-serialised.
//         A deck whose engine predates the live window is refused: it would not mount packed stations.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../edit/source.mjs';

export const fragmentName = st => {
  if (!st.key && !st.id) throw new Error('a station has neither data-key nor id: give it one so its fragment has a stable name');
  return (st.key || st.id).replace(/[^A-Za-z0-9_-]/g, '_') + '.html';
};

/** Pure: source HTML → { html, fragments: [{ name, content }] }. Throws on a deck the engine cannot stream. */
export function pack(html, { split = false, posters = null } = {}) {
  if (!/function mountStation\s*\(/.test(html))
    throw new Error('this deck\'s engine has no live window (mountStation): rebuild it from the current template before packing');
  const list = S.stations(html);
  if (!list.length) throw new Error('no <section class="station"> found');
  const names = new Set();
  const fragments = [];
  let out = html;
  // splice from the LAST station back, so earlier offsets stay valid
  for (const st of [...list].reverse()) {
    const content = S.inner(html, st.el);
    if (/<template\s[^>]*data-station/i.test(content) || st.el.attrs['data-src'])
      throw new Error(`station ${st.key || st.id} is already packed`);
    const name = fragmentName(st);
    // case-insensitive: Vega.html and VEGA.html are one file on macOS and Windows disks
    if (names.has(name.toLowerCase())) throw new Error(`two stations would share the fragment ${name}`);
    names.add(name.toLowerCase());
    let open = html.slice(st.el.start, st.el.openEnd);
    const extra = [];
    if (split) extra.push(`data-src="stations/${name}"`);
    if (posters && posters[st.id]) { open = open.replace(/\s+data-poster\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, ''); extra.push(`data-poster="${posters[st.id]}"`); }
    if (extra.length) open = open.replace(/\s*>$/, ' ' + extra.join(' ') + '>');
    const body = split ? '' : `<template data-station>${content}</template>`;
    if (split) fragments.unshift({ name, content });
    out = out.slice(0, st.el.start) + open + body + out.slice(st.el.closeStart);
  }
  return { html: out, fragments };
}

/* ---------------------------------------------------------------- CLI */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const src = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out');
  if (!src || !existsSync(src)) { console.error('usage: pack.mjs <deck.html> [--split] [--posters] [--out file]'); process.exit(2); }
  const split = argv.includes('--split'), wantPosters = argv.includes('--posters');
  const SRC = resolve(src), DIR = dirname(SRC);
  const outArg = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  const OUT = resolve(outArg || join(DIR, basename(SRC, extname(SRC)) + (split ? '.stream.html' : '.packed.html')));
  if (dirname(OUT) !== DIR) { console.error('the packed deck must sit next to its source: its assets are referenced relative to it'); process.exit(2); }
  if (OUT === SRC) { console.error('--out would overwrite the source deck: the source stays the one you author and edit'); process.exit(2); }
  const html = readFileSync(SRC, 'utf8');
  let posters = null;
  if (wantPosters) posters = await makePosters(SRC, html);
  let res;
  try { res = pack(html, { split, posters }); } catch (e) { console.error('FAIL: ' + e.message); process.exit(1); }
  if (split) {
    mkdirSync(join(DIR, 'stations'), { recursive: true });
    for (const f of res.fragments) writeFileSync(join(DIR, 'stations', f.name), f.content);
  }
  writeFileSync(OUT, res.html);
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  console.log(`${basename(OUT)}: ${kb(Buffer.byteLength(res.html))} (source ${kb(Buffer.byteLength(html))})` +
    (split ? `, ${res.fragments.length} fragments in stations/` : ', every station inside <template data-station>') +
    (posters ? `, ${Object.keys(posters).length} posters` : ''));
  if (split) console.log('serve the folder over http(s); a browser will not fetch stations/ from file://');
}

/* ---------------------------------------------------------------- posters: headless Chrome, no remote debugging */
async function makePosters(SRC, html) {
  const chrome = [process.env.DECK_BROWSER, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
  if (!chrome) { console.error('--posters needs Chrome (set DECK_BROWSER)'); process.exit(2); }
  const DIR = dirname(SRC), PAGE = '/' + basename(SRC);
  const srv = createServer((req, res) => {
    let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    const file = resolve(join(DIR, p));
    if (!(file.startsWith(DIR + sep)) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  mkdirSync(join(DIR, 'posters'), { recursive: true });
  const out = {};
  const list = S.stations(html);
  const shot = st => new Promise(done => {
    const name = fragmentName(st).replace(/\.html$/, '.png'), file = join(DIR, 'posters', name);
    const profile = mkdtempSync(join(tmpdir(), 'deck-poster-'));
    rmSync(file, { force: true });
    const p = spawn(chrome, ['--headless=new', '--hide-scrollbars', '--window-size=480,270', `--user-data-dir=${profile}`,
      '--virtual-time-budget=4000', `--screenshot=${file}`, `http://127.0.0.1:${port}${PAGE}?still=1#${st.id}`], { stdio: 'ignore' });
    let last = -1;   // a managed Chrome may linger after writing the file: stop it once the PNG is stable
    const poll = setInterval(() => { const sz = existsSync(file) ? statSync(file).size : -1; if (sz > 0 && sz === last) p.kill(); last = sz; }, 400);
    const guard = setTimeout(() => p.kill(), 60_000);
    p.on('exit', () => { clearInterval(poll); clearTimeout(guard); rmSync(profile, { recursive: true, force: true });
      if (existsSync(file)) out[st.id] = 'posters/' + name; done(); });
  });
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(shot));
  srv.close();
  return out;
}
