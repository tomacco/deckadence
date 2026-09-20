/* COMPONENT: site-iframe
 * WHAT   : a station that IS a real website — dive in, then auto-scroll the page content.
 * SPLICE : into the engine <script>, after the scene registry.
 * NEEDS  : animate, MOTION, cur, overview, stations
 * MARKUP : <section class="station site-full" id="s7" data-name="Demo site"
 *            data-x="…" data-y="…" data-fly="dive" data-scroll="6000">
 *            <iframe class="site-frame" src="../sites/demo/index.html"></iframe>
 *          </section>
 * CSS    : .station.site-full { padding: 0; overflow: hidden; }
 *          .site-frame { position:absolute; top:0; left:0; width:1920px; height:1080px;
 *                        border:0; pointer-events:none; background:#fff; }
 * WIRE   : at boot   document.querySelectorAll('.site-frame')
 *                      .forEach(f => f.addEventListener('load', () => sizeSiteFrame(f)));
 *          in goto() call stopSiteScroll() next to the scene stops, and start the scroll
 *          from the fly's `done` callback (it already fires on arrival):
 *            if (s.el.dataset.scroll) setTimeout(() => runSiteScroll(s), 350);
 * SAME-ORIGIN ONLY: serve the deck and the embedded sites from one local server.
 */

let siteScrollAnim = null;

// Keep the iframe at exactly 1920x1080. Resizing it to content height balloons the page's
// own 100vh hero, because an iframe's viewport IS its element size.
function sizeSiteFrame(f) {
  try {
    const doc = f.contentDocument || f.contentWindow.document;
    if (!doc.getElementById('__deck_noscroll')) {          // hide the page's own scrollbar
      const st = doc.createElement('style'); st.id = '__deck_noscroll';
      st.textContent = 'html,body{scroll-behavior:auto!important;scrollbar-width:none}' +
        'html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0;display:none}';
      (doc.head || doc.documentElement).appendChild(st);
    }
    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 1080);
    f.dataset.dist = String(Math.max(0, h - 1080));        // content scroll range
  } catch (e) { f.dataset.dist = '0'; }                     // cross-origin → no scroll, not a crash
}

function stopSiteScroll() {
  if (siteScrollAnim) { try { siteScrollAnim.pause(); } catch (e) {} siteScrollAnim = null; }
  document.querySelectorAll('.site-frame').forEach(f => {
    try { f.contentWindow.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {}
  });
}

function runSiteScroll(s) {
  const f = s.el.querySelector('.site-frame');
  if (!f) return;
  let win;
  try { win = f.contentWindow; win.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { return; }
  sizeSiteFrame(f);                          // recompute now that fonts/images settled
  const dist = +f.dataset.dist || 0;
  if (dist <= 0) return;                     // the scroll IS content — runs under reduced-motion too
  const token = cur, proxy = { y: 0 };
  siteScrollAnim = animate(proxy, {
    y: dist, duration: +s.el.dataset.scroll || 6000, ease: 'inOutSine',
    // behavior:'auto' is MANDATORY — it overrides the page's own scroll-behavior:smooth,
    // which otherwise fights per-frame updates (stutter, then snap).
    onUpdate: () => {
      if (cur !== token || overview) { stopSiteScroll(); return; }   // left the station
      try { win.scrollTo({ top: proxy.y, behavior: 'auto' }); } catch (e) {}
    }
  });
}
