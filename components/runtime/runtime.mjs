// runtime.mjs — the shared engine as the files a deck links, and the helpers that read them. Zero deps.
//
// A deck links deckadence/deckadence.css and deckadence/deckadence.js (a folder beside the deck file)
// and pins the runtime's MAJOR version on <html data-deckadence="2">. The source of truth is
// template/deckadence/; install.mjs copies it into a deck, check.mjs reads it, pack.mjs inlines it.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_DIR = 'deckadence';
export const FILES = ['deckadence.js', 'deckadence.css'];
export const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '../../template', RUNTIME_DIR);

/** '2.0.0' from the runtime's own source, or null. */
export const versionOf = js => (js.match(/const RUNTIME = '(\d+\.\d+\.\d+)'/) || [])[1] || null;
export const majorOf = v => (v ? v.split('.')[0] : null);
/** The major a deck is pinned to (<html data-deckadence="2">), or null. */
export const pinOf = html => {
  const tag = html.match(/<html\b[^>]*>/i);
  const m = tag && tag[0].match(/\sdata-deckadence=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};
export const setPin = (html, major) => html.replace(/<html\b[^>]*>/i, tag =>
  /\sdata-deckadence=/i.test(tag) ? tag.replace(/(\sdata-deckadence=)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${major}"`)
    : tag.replace(/>$/, ` data-deckadence="${major}">`));

const local = url => url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);
const clean = url => url.replace(/^\.\//, '').split(/[?#]/)[0];
/** True for a path inside the runtime folder (deckadence/…). */
export const inRuntime = url => local(url) && clean(url).startsWith(RUNTIME_DIR + '/');

/**
 * Replace LOCAL <script src> and <link rel="stylesheet" href> tags with the file's content inline.
 * `load(path)` returns the file's text, or null when it does not exist; `only(path)` picks the tags to
 * inline (default: every local one). Comments are left alone: a tag quoted in prose is not a tag.
 * Returns { html, inlined: [paths], missing: [paths] }.
 */
export function inlineLocal(html, load, { only = () => true } = {}) {
  const inlined = [], missing = [];
  const attr = (tag, n) => { const m = tag.match(new RegExp(`\\s${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[1] ?? m[2] ?? m[3]) : null; };
  const out = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>\s*<\/script>|<link\b[^>]*>/gi, tag => {
    if (tag.startsWith('<!--')) return tag;
    const isScript = /^<script/i.test(tag);
    if (!isScript && !/^stylesheet$/i.test(attr(tag, 'rel') || '')) return tag;
    const url = attr(tag, isScript ? 'src' : 'href');
    if (!local(url) || !only(url)) return tag;
    const text = load(clean(url));
    if (text == null) { missing.push(clean(url)); return tag; }
    inlined.push(clean(url));
    return isScript ? `<script>\n${text.replace(/<\/script/gi, '<\\/script')}</script>`
      : `<style>\n${text.replace(/<\/style/gi, '<\\/style')}</style>`;
  });
  return { html: out, inlined, missing };
}

/** A loader for inlineLocal: paths relative to the deck file, null when missing. */
export const loaderFor = deckFile => p => { try { return readFileSync(join(dirname(deckFile), p), 'utf8'); } catch { return null; } };
