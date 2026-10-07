/* deckadence runtime — the engine every deck shares (references/engine.md).
   A deck links this file and pins its MAJOR version on <html data-deckadence="2">. A fix ships here
   and reaches every deck on the same major through components/runtime/install.mjs; a change that
   would break a deck's markup or scenes is a new major. Never edit a deck's copy by hand.
   Loads after the stations and before the deck's own scripts; those register scenes on
   Deckadence.scenes, and the first reveal waits for DOMContentLoaded, so every scene is in place. */
(function () {
  const RUNTIME = '2.0.0';
  const pin = document.documentElement.dataset.deckadence;
  if (pin !== RUNTIME.split('.')[0])
    console.error(`[deckadence] this deck is pinned to runtime ${pin || '(no data-deckadence)'} but runtime ${RUNTIME} is loaded: install the matching runtime (components/runtime/install.mjs)`);
  const { animate, utils } = anime;
  // The weighty signature ease. MUST be the function form — the STRING
  // 'cubicBezier(...)' was removed from anime.js v4 and silently falls back
  // to linear (with a console warning). Named eases like 'out(3)' are fine.
  const EASE = anime.cubicBezier ? anime.cubicBezier(.82, 0, .18, 1) : 'inOutQuart';
  // PACE = the design direction's motion personality (see references/design.md:
  // Terminal 0.85, Editorial 1.15, Gallery 1.15, Midnight Luxe 1.25). 1 = neutral. A deck sets
  // it on <html data-pace="1.15">.
  const PACE = +document.documentElement.dataset.pace || 1;
  // Motion IS content. Reduced-motion (OS "animations off" — headless Chrome
  // reports it too) gets a calmer/faster scale, NEVER a dead cut.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOTION = (reduceMotion ? 0.6 : 1) * PACE;
  // ?still=1 → a FLAT frame: camera jumps, no entrance animation, every element painted at
  // its FINAL state. This is what makes the deck verifiable — a headless screenshot of an
  // animated station lands mid-rise and photographs as an EMPTY frame, so layout bugs hide.
  // Reduced-motion is NOT this (motion is content, it only scales durations).
  const STILL = /[?&]still=1(&|$)/.test(location.search);
  // Coarse pointer = phone/tablet: swipe nav, station culling, auto full screen on first swipe.
  const TOUCH = matchMedia('(pointer: coarse)').matches;

  /* ---------- collect stations ---------- */
  const nodes = Array.from(document.querySelectorAll('.station'));
  const stations = nodes.map(el => {
    const x = +el.dataset.x, y = +el.dataset.y, zoom = +el.dataset.zoom || 1;
    el.style.transform = `translate(${x}px, ${y}px)`;       // place on the plane
    return { el, x, y, w: el.offsetWidth, h: el.offsetHeight, zoom,
             cx: x + el.offsetWidth / 2, cy: y + el.offsetHeight / 2,
             name: el.dataset.name, key: el.dataset.key || '' };
  });
  // Deep-link resolution: `#s3` (positional id) or `#VEGA` (stable key, case-insensitive).
  // The id wins on a clash; check.mjs fails a deck whose key could clash with an id.
  function stationFromHash(h) {
    let t = (h || '').replace(/^#/, '');
    try { t = decodeURIComponent(t); } catch (e) {}
    if (!t) return -1;
    const byId = stations.findIndex(s => s.el.id === t);
    if (byId >= 0) return byId;
    const T = t.toUpperCase();
    return stations.findIndex(s => s.key && s.key.toUpperCase() === T);
  }

  const world = document.getElementById('world');
  const viewportEl = document.getElementById('viewport');
  const hud = document.getElementById('hud');
  const cam = { x: stations[0].cx, y: stations[0].cy, zoom: 1 };
  let cur = 0, busy = false, overview = false, navToken = 0;

  // The stage is the window minus a LEFT inset that a control layer may claim (edit mode's
  // slide navigator). 0 unless something sets it through Deckadence.setInset().
  let insetLeft = 0;
  function vw() { return window.innerWidth - insetLeft; }
  function vh() { return window.innerHeight; }
  function render() {
    world.style.transform =
      `translate(${insetLeft + vw() / 2 - cam.x * cam.zoom}px, ${vh() / 2 - cam.y * cam.zoom}px) scale(${cam.zoom})`;
  }
  // Fit the 16:9 frame to the viewport — type reads edge-to-edge ("big fonts"
  // comes from fitting the frame, not from raising font sizes).
  function fitZoom(s) { return Math.min(vw() / s.w, vh() / s.h) * s.zoom; }
  // Letterbox mask (see #viewport CSS): clip to the fitted frame at rest, open for flights.
  function maskToStation(s) {
    const z = fitZoom(s);
    const l = Math.max(0, (vw() - s.w * z) / 2).toFixed(1), t = Math.max(0, (vh() - s.h * z) / 2).toFixed(1);
    viewportEl.style.clipPath = `inset(${t}px ${l}px ${t}px ${(+l + insetLeft).toFixed(1)}px)`;
  }
  function unmask() { viewportEl.style.clipPath = 'inset(0px 0px 0px 0px)'; }
  // Phone survival: mobile Safari kills the tab under GPU/memory pressure — dozens of
  // stations on one composited plane is too much. On touch, paint only the current station
  // ±1; next/prev only ever cross adjacent stations, so flights still pan over painted
  // content (a dot-jump crosses blank world mid-flight, accepted). Desktop paints everything.
  function updateCulling() {
    if (!TOUCH) return;
    stations.forEach((s, k) => { s.el.style.visibility = (overview || Math.abs(k - cur) <= 1) ? '' : 'hidden'; });
  }

  /* ---------- live window: only stations near the camera exist in the DOM ----------
     Memory is the reason. Every station on the plane is laid out and painted, and every image in it
     is decoded, whether or not the camera is near it: a 68-station deck held ~400 MB in the renderer
     and ~300 MB on the GPU, from slide 1 (components/verify/memory.mjs measures this). So only the
     current station and LIVE_SPAN neighbours either side hold their content. The rest keep their
     frame (position, size, tone class) and nothing else; their HTML waits as text and is mounted
     again on approach. Content comes from one of three sources:
       · authored inline (the default while writing a deck): snapshotted here, before any engine or
         deck code touches it, so a remount always starts from the authored markup;
       · <template data-station> (a packed single file): inert, nothing in it loads until mounted;
       · data-src="stations/KEY.html" (a streamed deck): fetched on approach, prefetched ahead.
     A station's own setup (measuring, inlining, wiring) belongs in its scene's mount(el), which runs
     on EVERY mount, or in a 'deck:mount' listener: code that walks all stations once at boot sees
     only the live ones. <html data-live="all"> keeps every station mounted (old-style decks whose
     code does boot-time work per station). Edit mode works with the window too: it binds a station's
     text when the station mounts, and its navigator shows server-rendered posters, not live copies. */
  const LIVE_SPAN = TOUCH ? 1 : 2, PREFETCH_SPAN = LIVE_SPAN + 2, FETCH_MS = 10000;
  let liveAll = (document.documentElement.dataset.live || document.body.dataset.live) === 'all';
  stations.forEach(s => {
    const tpl = s.el.querySelector(':scope > template[data-station]');
    if (tpl) { s.src = tpl.innerHTML; tpl.remove(); s.live = false; }
    else if (s.el.dataset.src) { s.src = null; s.live = false; }
    else { s.src = s.el.innerHTML; s.live = true; }
    if (!s.live) s.el.classList.add('dormant');
  });
  const sceneOf = s => { const n = s.el.dataset.scene; return n ? sceneRegistry[n] : null; };
  // Fetch a streamed station once and keep its text. A failure leaves a visible note in the frame
  // rather than a hole, and is retried on the next approach.
  function loadSrc(s) {
    if (s.src != null) return Promise.resolve();
    if (s.loading) return s.loading;
    // a server that never answers must not hold the camera forever: give up after FETCH_MS
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), FETCH_MS);
    return (s.loading = fetch(s.el.dataset.src, ctl ? { signal: ctl.signal } : undefined)
      .then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text(); })
      .then(t => { s.src = t; })
      .catch(e => { console.warn('[deckadence] could not load', s.el.dataset.src, e); s.failed = true; })
      .finally(() => { clearTimeout(timer); s.loading = null; }));
  }
  // Mount = content in the DOM (inserted if it was released or never arrived) + the station's own
  // setup, run once per mount: the scene's mount(el) and a 'deck:mount' event. An authored station
  // that starts live is mounted the first time too, so per-station setup has ONE home whatever the
  // source. Returns true when done now, or a Promise when content or an async mount is on its way.
  function mountStation(s) {
    if (s.mounted) return true;
    if (s.mounting) return s.mounting;
    if (!s.live) {
      if (s.src == null && !s.failed) return loadSrc(s).then(() => mountStation(s));
      if (s.src == null) {                     // fetch failed: the frame says so, and counts as mounted
        // (live + mounted) so navigation goes on; released with the window, it is fetched again on
        // the next approach. Left unmounted, goto() would refetch it forever and hold the camera.
        s.el.innerHTML = `<p class="station-error">${s.key || s.el.id} · could not load ${s.el.dataset.src}</p>`;
        s.failed = false; s.live = s.mounted = true; s.el.classList.remove('dormant');
        return true;
      }
      s.el.innerHTML = s.src; s.live = true; s.primed = false;
      s.el.classList.remove('dormant'); s.el.style.backgroundImage = '';
    }
    // A scene's mount that throws or rejects breaks that station's setup, never the deck: it is
    // reported, and the station counts as mounted so navigation and release carry on.
    const sc = sceneOf(s);
    let r = null;
    try { r = sc && sc.mount ? sc.mount(s.el) : null; } catch (e) { console.error('[deckadence] mount failed:', s.key || s.el.id, e); }
    s.el.dispatchEvent(new CustomEvent('deck:mount', { bubbles: true, detail: { key: s.key, id: s.el.id } }));
    if (!(r && typeof r.then === 'function')) { s.mounted = true; return true; }
    const settle = () => { s.mounted = true; s.mounting = null; return true; };
    return (s.mounting = r.then(settle, e => { console.error('[deckadence] mount failed:', s.key || s.el.id, e); return settle(); }));
  }
  // Removing an element does not free what it decoded: Chrome keeps a removed <img>'s pixels until
  // memory pressure, so a deck's RSS still grew with every photo the presenter had seen (Linux CI:
  // 386 MB at 21 stations, 760 MB at 66). Point media at nothing first, then remove it.
  function releaseMedia(el) {
    el.querySelectorAll('img').forEach(i => { i.removeAttribute('srcset'); i.src = 'data:,'; });
    el.querySelectorAll('video, audio').forEach(m => { try { m.pause(); m.removeAttribute('src'); m.querySelectorAll('source').forEach(x => x.remove()); m.load(); } catch (e) {} });
    el.querySelectorAll('iframe').forEach(f => { f.src = 'about:blank'; });
  }
  function unmountStation(s) {
    if (!s.live || liveAll || s.mounting) return;
    const sc = sceneOf(s);
    if (s.mounted && sc && sc.unmount) sc.unmount(s.el);
    if (s.mounted) s.el.dispatchEvent(new CustomEvent('deck:unmount', { bubbles: true, detail: { key: s.key, id: s.el.id } }));
    releaseMedia(s.el);
    s.el.replaceChildren();
    s.live = false; s.mounted = false; s.primed = false;
    s.el.classList.add('dormant');
  }
  const near = (k, i, span) => Math.abs(k - i) <= span;
  // After an arrival: neighbours mounted (so the next step is instant), far stations released,
  // streamed stations a little further out fetched ahead. The departing station is released only
  // here, after the flight, never while the camera can still see it.
  function settleLive(i) {
    stations.forEach((s, k) => {
      if (liveAll || near(k, i, LIVE_SPAN)) { const m = mountStation(s); if (m !== true) m.catch(() => {}); }
      else unmountStation(s);
      if (!liveAll && s.src == null && near(k, i, PREFETCH_SPAN)) loadSrc(s);
    });
  }
  // A station's markup changed (edit mode saved it): the next mount uses the new text. The DOM of a
  // mounted station is the editor's business; this only keeps a remount from bringing back old text.
  function setSource(i, html) { const s = stations[i]; if (s && typeof html === 'string') s.src = html; }
  // Everything mounted (a full-deck export, a deck whose code cannot use mount(el)). One-way for the session: edits made in the
  // DOM must not be swapped back for the authored text.
  function setLive(mode) {
    if (mode !== 'all') return Promise.resolve();
    liveAll = true;
    return Promise.all(stations.map(s => mountStation(s))).then(() => {});
  }

  /* ---------- HUD ---------- */
  const rail = document.getElementById('rail');
  const railtip = document.createElement('div'); railtip.id = 'railtip'; document.body.appendChild(railtip);
  stations.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'dot' + (i ? '' : ' active');
    d.addEventListener('click', () => { if (!busy && i !== cur) goto(i); });
    d.addEventListener('mouseenter', () => {
      const r = d.getBoundingClientRect();
      railtip.textContent = [String(i + 1).padStart(2, '0'), s.key, s.name].filter(Boolean).join(' · ');
      railtip.style.left = (r.left + r.width / 2) + 'px';
      railtip.classList.add('show');
    });
    d.addEventListener('mouseleave', () => railtip.classList.remove('show'));
    rail.appendChild(d);
  });
  const dots = Array.from(rail.children);
  // Overview labels: the KEY (+ name, fainter) above each keyed station, on the plane.
  // Siblings of the stations in #world, never children, so no intro or scene sees them.
  stations.forEach(s => {
    if (!s.key) return;
    const t = document.createElement('div'); t.className = 'station-tag';
    t.textContent = s.key;
    if (s.name) { const n = document.createElement('span'); n.className = 'tag-name'; n.textContent = ' · ' + s.name; t.appendChild(n); }
    t.style.transform = `translate(${s.x}px, ${s.y}px) translateY(-140%)`;
    world.appendChild(t);
  });
  document.getElementById('total').textContent = String(stations.length).padStart(2, '0');
  // The rail does not scale: one dot per station overflows into the HUD corners past ~25.
  // Window the dots around the current one, sized from the MEASURED HUD (a hardcoded count
  // overlaps the counter on a phone, wastes space on a wall).
  // The HUD is a `1fr auto 1fr` grid: the rail is centred and both side columns get the SAME
  // width, so the budget is the inner width minus two column gaps minus TWO copies of the
  // wider side's need (the rail may not eat the counter's column any more than the name's). The
  // left side needs the counter; the right side (the station name) ellipsizes, so it only
  // reserves a readable minimum — never its full, per-slide text width (that would make the
  // window size itself change from slide to slide).
  function railWindow(i) {
    const n = dots.length;
    if (!n) return;
    // Measure the ACTIVE dot (always in the window; offsetWidth ignores its scale transform)
    // and the counter's intrinsic width (nowrap) — never positions, which depend on the rail.
    dots[i].classList.remove('out');               // a deep link / overview jump can land on a hidden dot
    const DOT = dots[i].offsetWidth || 8, GAP = parseFloat(getComputedStyle(rail).gap) || 10;
    const hs = getComputedStyle(hud), CLEAR = parseFloat(hs.columnGap) || 0;   // grid gap either side of the rail
    const inner = hud.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight);
    const counterW = hud.querySelector('.counter').scrollWidth;
    const nameMin = Math.min(160, inner * 0.2);    // room for "KEY · NAME…" before the ellipsis
    let avail = inner - 2 * (Math.max(counterW, nameMin) + CLEAR);
    if (!(inner > 0)) avail = Math.max(100, vw() * 0.5 - 2 * CLEAR);   // hidden HUD → a safe guess
    const max = Math.max(5, Math.floor((avail + GAP) / (DOT + GAP)));   // k dots span k·DOT + (k-1)·GAP
    if (n <= max) { dots.forEach(d => d.classList.remove('out', 'edge')); return; }
    const start = Math.min(Math.max(0, i - Math.floor(max / 2)), n - max), end = start + max - 1;
    dots.forEach((d, k) => {
      const inWin = k >= start && k <= end;
      d.classList.toggle('out', !inWin);
      // taper only the ends that have more stations beyond them: "there is more this way"
      d.classList.toggle('edge', inWin && ((k === start && start > 0) || (k === end && end < n - 1)));
    });
  }
  function setHud(i) {
    document.getElementById('idx').textContent = String(i + 1).padStart(2, '0');
    // KEY · NAME when the station has a key (the stable name to say out loud in review);
    // plain NAME otherwise, so keyless decks render exactly as before.
    const label = hud.querySelector('.station-name'), s = stations[i];
    label.textContent = s.name || '';
    if (s.key) {
      const k = document.createElement('span'); k.className = 'station-key'; k.textContent = s.key;
      label.prepend(k, s.name ? ' · ' : '');
    }
    dots.forEach((d, k) => d.classList.toggle('active', k === i));
    railWindow(i);
  }
  // Keep the URL on the current station, by KEY when it has one: a link copied mid-review
  // then survives a reorder. replaceState (no history spam) never fires hashchange.
  function syncHash(i) {
    const s = stations[i], h = '#' + encodeURIComponent(s.key || s.el.id);
    if (location.hash === h) return;
    try { history.replaceState(null, '', location.pathname + location.search + h); } catch (e) {}
  }
  // TONE is separate from the HUD's text because it is VISIBLE DURING A FLY: the letterbox
  // bars paint the viewport background, and the HUD ink flips with them. Flipped at t=0 it
  // repaints to the DESTINATION tone while the station being LEFT is still on screen — bars
  // that mismatch their station read as a bug. goto() times this to the camera's midpoint.
  function setTone(i) {
    const inv = stations[i].el.classList.contains('invert');
    hud.classList.toggle('on-invert', inv);
    document.body.classList.toggle('invert-hud', inv);
  }

  /* ---------- camera ---------- */
  // `mid` fires at the camera's midpoint (state changes that must hide inside the move),
  // `done` on arrival (the station's reveal). Both optional.
  function flyTo(target, { dur = 1150, ease = EASE, mid, done } = {}) {
    if (STILL) { Object.assign(cam, target); render(); maskToStation(stations[cur]); if (mid) mid(); if (done) done(); return; }
    busy = true; unmask();
    const D = dur * MOTION;
    if (mid) setTimeout(mid, D * 0.55);
    animate(cam, { x: target.x, y: target.y, zoom: target.zoom,
      duration: D, ease, onUpdate: render,
      onComplete: () => { busy = false; maskToStation(stations[cur]); if (done) done(); } });
  }
  // "Dive": pull back so the next station reads as an object in space, then push in.
  // Use for showcase moments (data-fly="dive"); plain flyTo is the default glide.
  function flyDive(s, { mid, done } = {}) {
    const target = { x: s.cx, y: s.cy, zoom: fitZoom(s) };
    if (STILL) { Object.assign(cam, target); render(); maskToStation(s); if (mid) mid(); if (done) done(); return; }
    busy = true; unmask();
    const D = 1750 * MOTION;
    if (mid) setTimeout(mid, D * 0.55);
    animate(cam, { x: target.x, y: target.y,
      zoom: [
        { to: target.zoom * 0.34, duration: 720 * MOTION, ease: 'inOutQuad' },
        { to: target.zoom,        duration: 1030 * MOTION, ease: EASE }
      ],
      duration: D, ease: EASE, onUpdate: render,
      onComplete: () => { busy = false; maskToStation(s); if (done) done(); } });
  }
  // data-fly="through-overview": the station arrives via the map. Pull out to the overview, hold, then
  // dive in. The deck's one spatial flourish: use it once, usually near the end.
  function flyThroughOverview(s, { mid, done } = {}) {
    const target = { x: s.cx, y: s.cy, zoom: fitZoom(s) };
    if (STILL) { Object.assign(cam, target); render(); maskToStation(s); if (mid) mid(); if (done) done(); return; }
    busy = true; unmask();
    const c = overviewCam();
    animate(cam, { x: c.x, y: c.y, zoom: c.zoom, duration: 1000 * MOTION, ease: EASE, onUpdate: render,
      onComplete: () => setTimeout(() => {
        if (mid) mid();                       // tone flips while the map is on screen
        animate(cam, { x: target.x, y: target.y, zoom: target.zoom, duration: 1150 * MOTION, ease: EASE, onUpdate: render,
          onComplete: () => { busy = false; maskToStation(s); if (done) done(); } });
      }, 480) });                             // the hold IS the beat: do not shorten it
  }
  function overviewCam() {
    const pad = 200;
    const minX = Math.min(...stations.map(s => s.x)) - pad, maxX = Math.max(...stations.map(s => s.x + s.w)) + pad;
    const minY = Math.min(...stations.map(s => s.y)) - pad, maxY = Math.max(...stations.map(s => s.y + s.h)) + pad;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
             zoom: Math.min(vw() / (maxX - minX), vh() / (maxY - minY)) };
  }
  function toOverview() {
    overview = true; busy = true; unmask(); updateCulling();
    document.body.classList.add('is-overview');
    // dormant frames show their poster (a small still, if the deck was packed with one): the overview
    // never mounts the whole deck, which is the memory spike the live window exists to avoid
    stations.forEach(s => { if (!s.live && s.el.dataset.poster) s.el.style.backgroundImage = `url("${s.el.dataset.poster}")`; });
    const c = overviewCam();
    animate(cam, { x: c.x, y: c.y, zoom: c.zoom, duration: 1300 * MOTION, ease: EASE,
      onUpdate: render, onComplete: () => busy = false });
  }

  /* ---------- scene registry ----------
     A bespoke animated station registers { run(el), stop() } under a name and
     opts into it with data-scene="name". goto() stops EVERY scene on every
     move (cancel-on-leave) and runs the new station's scene instead of the
     generic intro. See references/motion.md for the controller pattern. */
  const sceneRegistry = {};

  /* ---------- navigation ---------- */
  // A streamed station that is not here yet holds the camera (busy) until it is, then the
  // navigation runs as if it had been; a newer navigation in the meantime wins.
  // deck:arrive (after the reveal starts) and deck:leave (at departure) bubble from the station, so a
  // deck's own script can start and stop per-station work (components/addons/site-iframe.js).
  const emit = (s, type) => s.el.dispatchEvent(new CustomEvent('deck:' + type, { bubbles: true, detail: { key: s.key, id: s.el.id } }));
  function holdFor(pending, then) {
    busy = true; const t = ++navToken;
    pending.then(() => { busy = false; if (t === navToken) then(); }, () => { busy = false; });
  }
  function goto(i, opts) {
    if (i < 0 || i >= stations.length) return;
    // The destination must hold its content before it is primed.
    const m = mountStation(stations[i]);
    if (m !== true) return holdFor(m, () => goto(i, opts));
    const prev = cur, wasOverview = overview; cur = i; overview = false;
    if (wasOverview) stations.forEach(t => { if (!t.live) t.el.style.backgroundImage = ''; });   // posters are an overview thing
    document.body.classList.remove('is-overview');
    setHud(i); updateCulling(); syncHash(i);
    Object.values(sceneRegistry).forEach(sc => sc.stop());
    emit(stations[prev], 'leave');
    const s = stations[i], isNew = i !== prev;
    const token = ++navToken;
    const fresh = () => token === navToken && !overview;   // still the current navigation?
    // A station's reveal fires ON ARRIVAL, never at t=0. Dispatched at departure, a scene
    // spends its opening beats playing to a camera that is still travelling — and on a
    // `dive` that is 1.75s of choreography the audience watches from across the plane.
    // Guarded by a nav token so an interrupted fly never reveals over another station.
    // PRIME NOW, reveal on arrival: the destination is hidden before the camera shows it.
    primeStation(s);
    const reveal = () => { if (fresh()) { revealStation(s); emit(s, 'arrive'); settleLive(i); } };
    const mid = () => { if (fresh()) setTone(i); };
    // Same-station replay (Esc/↓): no flight to wait for, so reveal at once. Scenes were
    // stopped above and must never be left frozen mid-draw.
    if (!isNew) { setTone(i); flyTo({ x: s.cx, y: s.cy, zoom: fitZoom(s) }, opts); reveal(); return; }
    if (s.el.dataset.fly === 'dive') flyDive(s, { mid, done: reveal });
    else if (s.el.dataset.fly === 'through-overview') flyThroughOverview(s, { mid, done: reveal });
    else flyTo({ x: s.cx, y: s.cy, zoom: fitZoom(s) }, { ...opts, mid, done: reveal });
  }

  /* ---------- generic intro ----------
     HARD RULE: every station gets a transition on arrival, even subtle.
     Big display = weighty LINE-rise. Everything else = calm fade-up.   */

  // Split a heading into LINES at explicit <br> — NEVER into characters
  // (char inline-blocks let the browser break words mid-word: "sys/tem").
  function splitLines(el) {
    if (el.dataset.done) return;
    el.innerHTML = el.innerHTML.split(/<br\s*\/?>/i)
      .map(html => `<span class="clip"><span class="lineInner">${html}</span></span>`)
      .join('');
    el.dataset.done = '1';
  }
  // Shrink the heading until every <br>-delimited line fits ONE visual line.
  function fitHeading(el) {
    if (el.dataset.fit) return; el.dataset.fit = '1';
    const lines = [...el.querySelectorAll('.lineInner')];
    if (!lines.length) return;
    const wraps = l => {
      const lh = parseFloat(getComputedStyle(l).lineHeight) || parseFloat(getComputedStyle(l).fontSize) * 1.2;
      return l.offsetHeight > lh * 1.3;
    };
    let guard = 0;
    while (lines.some(wraps) && guard++ < 26) {
      el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * 0.94).toFixed(1) + 'px';
    }
  }
  // Release the clip masks once lines land, so descenders are never cropped.
  function releaseClips(el) { el.querySelectorAll('.clip').forEach(c => { c.style.overflow = 'visible'; }); }

  // What the generic intro animates: heading LINES (split + fitted once) and data-fade elements
  // (or, on a station with neither, its non-absolute children).
  function introTargets(el) {
    el.querySelectorAll('[data-split="lines"]').forEach(splitLines);
    el.querySelectorAll('[data-split="lines"]').forEach(fitHeading);
    const lines = el.querySelectorAll('.lineInner');
    const fades = Array.from(el.querySelectorAll('[data-fade]'));
    let autos = [];
    if (!lines.length && !fades.length) {
      autos = Array.from(el.children).filter(c => getComputedStyle(c).position !== 'absolute');
    }
    return { lines, fadeTargets: [...fades, ...autos] };
  }
  // PRIME = the initial (hidden) state. Runs at DEPARTURE via primeStation(), never on arrival.
  function primeIntro(el) {
    el.querySelectorAll('.clip').forEach(c => { c.style.overflow = 'hidden'; });  // re-mask for replays
    const { lines, fadeTargets } = introTargets(el);
    // guard empty lists — anime warns on no targets
    if (lines.length) utils.set(lines, { translateY: '100%' });
    if (fadeTargets.length) utils.set(fadeTargets, { opacity: 0, translateY: 22 });
  }
  // PLAY = animate from the primed state. Never sets an initial state itself.
  function playIntro(el) {
    const { lines, fadeTargets } = introTargets(el);
    if (STILL) {                     // flat final frame: what a screenshot must show
      releaseClips(el);
      if (lines.length) utils.set(lines, { translateY: '0%' });
      if (fadeTargets.length) utils.set(fadeTargets, { opacity: 1, translateY: 0 });
      return;
    }
    if (lines.length) animate(lines, { translateY: ['100%', '0%'], duration: 1150 * MOTION,
      delay: anime.stagger(150 * MOTION), ease: EASE, onComplete: () => releaseClips(el) });
    else releaseClips(el);
    if (fadeTargets.length) animate(fadeTargets, { opacity: [0, 1], translateY: [22, 0],
      duration: 900 * MOTION, delay: anime.stagger(110 * MOTION, { start: (lines.length ? 440 : 90) * MOTION }),
      ease: 'out(2)' });
  }

  // The ONE dispatch point for "show this station" — used by goto() on arrival AND by boot,
  // so the deep-link path can never drift from the navigation path.
  // A scene owns its own intro; the generic intro covers everything else. In STILL mode a
  // scene may expose an optional still(el) that paints its final frame (needed only when the
  // scene's CSS rest state is hidden — e.g. paths pre-set to a full dashoffset).
  function revealStation(s) {
    const name = s.el.dataset.scene, sc = name && sceneRegistry[name];
    if (STILL) { if (sc && sc.still) sc.still(s.el); playIntro(s.el); return; }
    // Safety net: a path that reveals without priming (a custom fly, an addon) still animates,
    // but it flashes: that is a bug in the caller, so say so. components/verify/flash.mjs finds it.
    if (!s.primed) { console.warn('[deckadence] station revealed without priming (it will flash):', s.key || s.el.id); primeStation(s); }
    s.primed = false;
    if (sc) { sc.run(s.el); return; }
    playIntro(s.el);
  }
  // PRIME a station: put everything its reveal will animate into the INITIAL state. goto() calls
  // this at DEPARTURE, while the destination is still masked off-screen, so the flight shows the
  // station EMPTY and the reveal on arrival only ever ADDS. Priming on arrival (inside run() or
  // the intro) is the final-state flash: the flight shows the finished station, arrival hides it,
  // then it animates back in (pitfalls.md trap 2). A scene primes through its prep(el).
  function primeStation(s) {
    s.primed = true;
    if (STILL) return;
    const name = s.el.dataset.scene, sc = name && sceneRegistry[name];
    if (!sc) { primeIntro(s.el); return; }
    if (sc.prep) sc.prep(s.el);
    else console.warn('[deckadence] scene "' + name + '" has no prep(el): it will flash on every arrival');
  }

  /* ---------- input ---------- */
  function next() { if (!busy && cur < stations.length - 1) goto(cur + 1); }
  function prev() { if (!busy && cur > 0) goto(cur - 1); }
  // ONE step dispatch for arrows AND swipes. The current station's scene sees the step first: a
  // handleKey(dir) that returns true consumes it (a presenter-beat reveal, components/scenes/reveal.js;
  // an auto-play reel, references/motion.md), false lets the deck move on.
  function step(dir) {
    const sc = !overview && sceneOf(stations[cur]);
    if (sc && sc.handleKey && sc.handleKey(dir)) return;
    dir > 0 ? next() : prev();
  }

  // True full screen (Fullscreen API) — no browser chrome. HUD button or F.
  function toggleFullscreen() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) { try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  }
  const fsbtn = document.getElementById('fsbtn');
  fsbtn.addEventListener('click', () => { toggleFullscreen(); fsbtn.blur(); });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
    document.body.classList.toggle('is-fullscreen', !!(document.fullscreenElement || document.webkitFullscreenElement));
  }));
  // iPhone Safari has NO element fullscreen (iPad/Android do; iPhone only allows <video>).
  // Flag body so chrome copy offers the honest path (Add to Home Screen) and drop the
  // button rather than show a dead control.
  if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) {
    document.body.classList.add('no-fullscreen');
    fsbtn.style.display = 'none';
  }

  window.addEventListener('keydown', e => {
    // Typing is not navigating: a caret in a text field or an editable heading owns its keys
    // (edit mode — components/edit/ — makes station text contenteditable).
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'o' || e.key === 'O' || e.key === 'ArrowUp') { e.preventDefault(); if (!busy) toOverview(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    else if (e.key === 'ArrowDown' || e.key === 'Escape') { e.preventDefault(); if (!busy) goto(cur); }
  });

  // Touch: a single-finger swipe IS the arrow keys (same step() dispatch). Multi-touch is
  // left to the browser so pinch-zoom keeps working; while pinch-zoomed in, swipes pan.
  // A fullscreen request needs a user gesture — the first swipe qualifies, so it enters
  // full screen automatically (once: if the reader exits, respect it). The landscape lock
  // works on Android, rejects silently on iOS (the reader rotates physically).
  let swipeHint = null;
  function removeSwipeHint() { if (swipeHint) { swipeHint.remove(); swipeHint = null; } }
  if (TOUCH && !STILL) {
    swipeHint = document.createElement('div');
    swipeHint.id = 'swipehint'; swipeHint.textContent = 'Swipe to navigate';
    document.body.appendChild(swipeHint);
    swipeHint.addEventListener('animationend', removeSwipeHint);
  }
  function requestDeckFullscreen(lockLandscape) {
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      const p = req.call(el);
      if (p && p.catch) p.catch(() => {});
      if (lockLandscape && screen.orientation && screen.orientation.lock)
        Promise.resolve(p).then(() => screen.orientation.lock('landscape')).catch(() => {});
    } catch (e) {}
  }
  let fsAuto = false, touch = null;
  window.addEventListener('touchstart', e => {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  window.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
  window.addEventListener('touchend', e => {
    if (!touch || e.touches.length) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (window.visualViewport && window.visualViewport.scale > 1.05) return;  // zoomed in → panning
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 48) return;                       // a tap, not a swipe
    if (TOUCH && !fsAuto) { fsAuto = true; requestDeckFullscreen(false); }
    removeSwipeHint();
    step((ax >= ay ? dx : dy) < 0 ? 1 : -1);                 // left/up = next, right/down = prev
  }, { passive: true });
  // Portrait overlay (CSS shows it only on small portrait touch screens): tapping it is a
  // gesture too — go full screen (+ try the landscape lock, since rotating is the ask).
  document.getElementById('rotatehint').addEventListener('click', () => {
    fsAuto = true;
    requestDeckFullscreen(true);
    document.body.classList.add('rh-dismissed');
  });

  // click a station while in overview to fly to it
  stations.forEach((s, i) => s.el.addEventListener('click', () => { if (overview && !busy) goto(i); }));

  function refit() {
    stations.forEach(s => { s.w = s.el.offsetWidth; s.h = s.el.offsetHeight; s.cx = s.x + s.w / 2; s.cy = s.y + s.h / 2; });
    railWindow(cur);
    if (overview) toOverview();
    else { const s = stations[cur]; cam.x = s.cx; cam.y = s.cy; cam.zoom = fitZoom(s); render(); maskToStation(s); }
  }
  window.addEventListener('resize', refit);

  /* ---------- control-layer hooks ----------
     The ONE surface an outside layer (edit mode: components/edit/) may use. The engine stays
     the owner of the camera and the reveal; a layer asks through here and never re-implements
     either. Read-only view of the stations: order is DOM order; data-key (s.key) is the stable
     address, ids are positional. */
  window.Deckadence = {
    version: 1, runtime: RUNTIME,
    cam, stations, world, viewport: viewportEl,
    current: () => cur, isBusy: () => busy, isOverview: () => overview, still: STILL,
    goto, toOverview, render, fitZoom, primeStation, revealStation, splitLines, fitHeading, releaseClips,
    mountStation, setLive, setSource, isLive: i => !!(stations[i] && stations[i].live), liveSpan: LIVE_SPAN,
    setInset(px) { insetLeft = Math.max(0, +px || 0); refit(); },
    isPresenting: () => !!(document.fullscreenElement || document.webkitFullscreenElement),
    // for the deck's own scripts: its scenes, the shared motion scale, the intro and the steps
    scenes: sceneRegistry, MOTION, EASE, primeIntro, playIntro, step, next, prev,
  };

  // Editing the hash on a loaded deck (#ORION, #s3) flies there. A hash that arrives while
  // the camera is in flight is NOT dropped (the URL and the deck would then disagree): it is
  // retried until the flight lands, re-reading the hash so the latest edit wins.
  let hashRetry = 0;
  function followHash() {
    clearTimeout(hashRetry);
    const i = stationFromHash(location.hash);
    if (i < 0 || (i === cur && !overview)) return;
    if (busy) { hashRetry = setTimeout(followHash, 120); return; }
    goto(i);
  }
  window.addEventListener('hashchange', followHash);

  /* ---------- boot (deep links for rehearsal: #s3 by position, #ORION by key) ---------- */
  const hashIdx = stationFromHash(location.hash);
  const start = hashIdx >= 0 ? hashIdx : 0;
  // Normalise a deep link to the station's KEY (#s3 → #ORION, #orion → #ORION), so the URL
  // the reader copies is the stable one. Not in ?still=1: shoot.sh owns that URL.
  if (hashIdx >= 0 && !STILL) syncHash(start);
  cur = start;
  // Release everything outside the start window BEFORE first paint: an authored deck's far stations
  // never get laid out, painted or decoded. The start station itself may still be on its way.
  stations.forEach((s, k) => { if (!liveAll && !near(k, start, LIVE_SPAN)) unmountStation(s); });
  document.body.classList.add('deck-ready');          // the plane may paint now (see #world CSS)
  // The first mount waits for the whole document, so 'deck:mount' listeners in later scripts hear it
  // like every other mount.
  const bootMount = new Promise(r => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => r(mountStation(stations[start])), { once: true })
    : r(mountStation(stations[start])));
  cam.x = stations[start].cx; cam.y = stations[start].cy; cam.zoom = fitZoom(stations[start]);
  render();
  maskToStation(stations[start]);
  setHud(start);
  setTone(start);          // boot has nothing to hide behind — flip immediately
  updateCulling();
  // Hide the start station BEFORE first paint (hard rule 4: no final-state flash),
  // and wait for fonts so fitHeading measures real metrics (cached per element).
  stations[start].el.style.visibility = 'hidden';
  Promise.all([document.fonts.ready, new Promise(r => setTimeout(r, 240)), bootMount]).then(() => {
    const st = stations[start];
    updateCulling();                                   // (touch: re-cull if the user moved on)
    railWindow(cur);                                   // web fonts can widen the counter
    if (cur !== start) { st.el.style.visibility = ''; return; }   // user already navigated away
    primeStation(st);                                  // initial state first...
    st.el.style.visibility = '';                       // ...then visible, same tick → no flash
    revealStation(st);
    emit(st, 'arrive');
    settleLive(start);                                 // neighbours mounted, far ones fetched ahead
  });
})();
