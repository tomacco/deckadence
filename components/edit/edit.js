/* COMPONENT · edit/edit.js — the edit layer: a control surface for the HUMAN, in the browser.
   WHAT  · Opt-in authoring over a served deck: edit text in place, drop comments addressed to
           the agent, decide on the agent's proposals, reorder stations in a navigator.
           Every action writes to disk (the deck's source, or its sidecar index.review.json)
           through serve.mjs — an edit only the browser knows about does not exist for the agent.
   SPLICE · none. serve.mjs injects it into the deck page on the wire; decks never carry it.
   NEEDS · window.Deckadence (engine hooks, template/starter.html) — the layer asks the engine
           to move and re-fit; it never re-implements the camera or the reveal.
   ON    · ?edit=1, or Ctrl+Shift+E (⌘⇧E). Never during a presentation: full screen turns it off.
   KEYS  · T text · C comment · N navigator · R show resolved · Esc close · arrows still navigate. */
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  // Navigator thumbnails load this same page in flat mode: paint the deck, nothing else.
  if (Q.get('dk') === 'thumb') { document.documentElement.classList.add('dk-thumb'); return; }
  if (window.top !== window) return;
  const D = window.Deckadence;
  if (!D) { console.warn('[deckadence edit] this deck predates window.Deckadence — rebuild it from the current template to edit it'); return; }
  if (D.still) return;

  /* ---------- small tools ---------- */
  const $ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = iso => { const s = (Date.now() - Date.parse(iso)) / 1000;
    return s < 50 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : new Date(iso).toLocaleDateString(); };
  const IC = {
    text:    '<svg viewBox="0 0 24 24"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg>',
    comment: '<svg viewBox="0 0 24 24"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4V6a1 1 0 0 1 1-1z"/></svg>',
    slides:  '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/></svg>',
    close:   '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  const KEY = 'dk-edit:' + location.pathname;
  const session = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } },
    set(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  };
  async function api(name, body) {
    try {
      const r = await fetch('/__deck/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      return { ...j, ok: r.ok && j.ok !== false, status: r.status };
    } catch (e) { return { ok: false, status: 0, error: 'the edit server is not answering — is serve.mjs still running?' }; }
  }

  /* ---------- state ---------- */
  let on = false, tool = 'text', navOpen = false, showResolved = false;
  let st = null;                 // server state: { author, order, map, review }
  let editing = null;            // { el, unit }
  let card = null;               // { kind: 'thread'|'compose', id?, el, ghost? }
  let es = null, pendingReload = false, raf = 0;
  const byId = id => D.stations.find(s => s.el.id === id);

  /* ---------- chrome ---------- */
  const frame = $('div', 'dk'); frame.id = 'dk-frame';
  const bar = $('div', 'dk'); bar.id = 'dk-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Edit mode');
  bar.innerHTML = `
    <div class="dk-brand"><i></i><span>Edit</span></div>
    <button class="dk-tool" data-tool="text" title="Edit text (T)">${IC.text}<span class="dk-lbl">Text</span><span class="dk-kbd">T</span></button>
    <button class="dk-tool" data-tool="comment" title="Comment (C)">${IC.comment}<span class="dk-lbl">Comment</span><span class="dk-kbd">C</span></button>
    <button class="dk-tool" data-nav title="Slides (N)">${IC.slides}<span class="dk-lbl">Slides</span><span class="dk-kbd">N</span></button>
    <div class="dk-sep"></div>
    <button id="dk-inbox" title="Next comment · R shows resolved"><b>0</b> open<span class="dk-need"></span></button>
    <div id="dk-status"><i></i><span>Ready</span></div>
    <button id="dk-done" title="Leave edit mode (Ctrl+Shift+E)" aria-label="Leave edit mode">${IC.close}</button>`;
  const pins = $('div', 'dk'); pins.id = 'dk-pins';
  const nav = $('aside', 'dk'); nav.id = 'dk-nav'; nav.setAttribute('aria-label', 'Slides');
  nav.innerHTML = `<header><h2>Slides <span></span></h2><p>Drag to reorder · ids never change, so #links keep working</p></header><div id="dk-list"></div>`;
  const toastEl = $('div', 'dk'); toastEl.id = 'dk-toast'; toastEl.setAttribute('role', 'status');
  document.body.append(frame, pins, nav, bar, toastEl);
  // Keys inside the layer's own UI never reach the deck (Space on a button, arrows in the
  // navigator). Stopped while BUBBLING, so the field or button itself still gets them.
  function shield(el) {
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); if (card && card.el === el) closeCard(); }
      e.stopPropagation();
    });
  }
  [nav, bar].forEach(shield);
  const statusEl = bar.querySelector('#dk-status'), inboxEl = bar.querySelector('#dk-inbox'), listEl = nav.querySelector('#dk-list');

  let toastT = 0;
  function toast(msg, bad) {
    toastEl.innerHTML = `<i></i><span>${esc(msg)}</span>`; toastEl.classList.toggle('bad', !!bad);
    toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), bad ? 5200 : 2600);
  }
  function status(kind, text) { statusEl.className = kind || ''; statusEl.querySelector('span').textContent = text; }

  /* ---------- on / off ---------- */
  function persist() { session.set({ on, tool, navOpen, showResolved }); }
  function setOn(v) {
    if (v && D.isPresenting()) { toast('Leave full screen to edit — edit mode never runs during a presentation', true); return; }
    if (v === on) return;
    on = v;
    document.body.classList.toggle('dk-on', on);
    if (on) {
      connect(); refresh(); setTool(tool); setNav(navOpen);
      raf = requestAnimationFrame(tick);
    } else {
      if (editing) commitEdit(false);
      closeCard(); setTool(null, true); D.setInset(0);
      if (es) { es.close(); es = null; }
      cancelAnimationFrame(raf);
    }
    persist();
  }
  function setTool(t, silent) {
    if (editing && t !== 'text') commitEdit(false);
    if (!silent) tool = t;
    document.body.classList.toggle('dk-tool-text', on && t === 'text');
    document.body.classList.toggle('dk-tool-comment', on && t === 'comment');
    bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    if (!silent) persist();
  }
  function setNav(v) {
    navOpen = v;
    document.body.classList.toggle('dk-nav-open', v);
    bar.querySelector('[data-nav]').classList.toggle('on', v);
    D.setInset(on && v ? nav.offsetWidth || 304 : 0);
    if (v) renderNav();
    persist();
  }
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) setTool(tool === b.dataset.tool ? null : b.dataset.tool);
    else if (b.hasAttribute('data-nav')) setNav(!navOpen);
    else if (b.id === 'dk-done') setOn(false);
    else if (b.id === 'dk-inbox') nextComment();
    b.blur();   // a focused button would eat the arrow keys the presenter navigates with
  });

  /* ---------- server state + live channel ---------- */
  async function refresh() {
    try { st = await (await fetch('/__deck/state', { cache: 'no-store' })).json(); }
    catch { status('error', 'Offline'); return; }
    if (st.error) { status('error', 'Error'); toast(st.error, true); return; }
    bindUnits(); renderPins(); updateInbox();
    if (navOpen) renderNav(true);
    if (card && card.kind === 'thread') { const c = findC(card.id); c ? openThread(c, true) : closeCard(); }
  }
  function connect() {
    if (es) return;
    es = new EventSource('/__deck/events');
    es.addEventListener('review', () => refresh());
    es.addEventListener('deck', () => { if (editing || card) { pendingReload = true; toast('The deck changed on disk — reloading when you finish'); } else reloadHere(); });
    es.onerror = () => status('error', 'Offline');
    es.onopen = () => { if (statusEl.classList.contains('error')) status('', 'Ready'); };
  }
  function reloadHere() {
    persist();
    const s = D.stations[D.current()];
    history.replaceState(null, '', location.pathname + location.search + '#' + s.el.id);
    location.reload();
  }

  /* ---------- editable text units ---------- */
  function bindUnits() {
    document.querySelectorAll('.dk-editable').forEach(e => { if (e !== (editing && editing.el)) { e.classList.remove('dk-editable'); delete e.__dkUnit; } });
    for (const s of D.stations) {
      for (const u of (st.map[s.el.id] || [])) {
        let el = s.el;
        for (const k of u.path) { el = el && el.children[k]; }
        if (!el || el.tagName.toLowerCase() !== u.tag) continue;    // live DOM drifted from source: leave it locked
        el.__dkUnit = u; el.classList.add('dk-editable');
      }
    }
  }
  const isHeading = el => el.hasAttribute('data-split') || /^H[1-6]$/.test(el.tagName);
  // Put a unit back to rest from its SOURCE markup: headings are re-split and re-fitted from
  // scratch (fitHeading only ever shrinks, so the old size must be cleared first).
  function paint(el, html) {
    el.innerHTML = html;
    if (el.getAttribute('data-split') === 'lines') {
      el.style.fontSize = ''; delete el.dataset.fit; delete el.dataset.done;
      D.splitLines(el); D.fitHeading(el); D.releaseClips(el);
    }
  }
  function beginEdit(el, ev) {
    if (editing) commitEdit(false);
    const u = el.__dkUnit; if (!u) return;
    editing = { el, unit: u };
    // Edit the ORIGINAL markup, never the split output: the next reveal re-splits whatever is here.
    el.innerHTML = u.html; delete el.dataset.done;
    el.contentEditable = 'true'; el.spellcheck = true;
    el.classList.add('dk-editing');
    el.focus({ preventScroll: true });
    const r = ev && document.caretRangeFromPoint && document.caretRangeFromPoint(ev.clientX, ev.clientY);
    const sel = getSelection();
    if (r && el.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); }
    status('', 'Editing');
  }
  async function commitEdit(cancel) {
    if (!editing) return;
    const { el, unit } = editing; editing = null;
    el.removeAttribute('contenteditable'); el.classList.remove('dk-editing');
    const html = el.innerHTML;
    const same = html.replace(/<br>$/, '') === unit.html;
    if (cancel || same) { paint(el, unit.html); status('', cancel ? 'Cancelled' : 'Ready'); return afterEdit(); }
    paint(el, html);                                   // optimistic: show it while it saves
    status('saving', 'Saving…');
    const r = await api('text', { key: unit.key, base: unit.html, html, selector: selectorFor(el, byId(unit.key.split(':')[0]).el) });
    if (r.ok) { unit.html = r.html ?? unit.html; paint(el, unit.html); status('saved', 'Saved'); reloadThumb(unit.key.split(':')[0]); }
    else { paint(el, unit.html); status('error', 'Not saved'); toast(r.error || 'Not saved', true); if (r.status === 409) refresh(); }
    afterEdit();
  }
  function afterEdit() { if (pendingReload && !card) reloadHere(); }

  /* ---------- selectors: comments survive a layout change ---------- */
  const ENGINE = new Set(['clip', 'lineInner', 'dk-editable', 'dk-editing']);
  function lift(el, stEl) {       // out of the engine's split spans, up to the authored element
    const h = el.closest && el.closest('[data-split]');
    return h && stEl.contains(h) ? h : el;
  }
  function selectorFor(el, stEl) {
    const parts = [];
    for (let n = lift(el, stEl); n && n !== stEl; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter(c => !ENGINE.has(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map(CSS.escape).join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter(x => x.tagName === n.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return ['#' + CSS.escape(stEl.id), ...parts].join(' > ').replace(/^(#[^ ]+) > (#)/, '$2');
  }

  /* ---------- comments + pins ---------- */
  const findC = id => st && st.review.comments.find(c => c.id === id);
  const needs = c => (c.replies || []).some(r => r.proposal && !r.decision);
  function anchorEl(c) {
    if (!c.anchor || !c.anchor.selector) return null;
    try { return document.querySelector(c.anchor.selector); } catch { return null; }
  }
  function pinPoint(c) {
    const a = anchorEl(c), off = c.anchor && c.anchor.offset;
    if (a && off) { const r = a.getBoundingClientRect(); if (r.width || r.height) return [r.left + off.x * r.width, r.top + off.y * r.height]; }
    const s = byId(c.station); if (!s) return null;
    const r = s.el.getBoundingClientRect();
    return [r.left + c.at.x / s.w * r.width, r.top + c.at.y / s.h * r.height];
  }
  function renderPins() {
    pins.textContent = '';
    for (const c of st.review.comments) {
      if (c.resolved && !showResolved) continue;
      const p = $('button', 'dk-pin' + (c.resolved ? ' resolved' : '') + (needs(c) ? ' need' : ''), esc(c.id.replace(/^c/, '')));
      p.dataset.id = c.id; p.title = c.text;
      p.addEventListener('click', e => { e.stopPropagation(); openThread(c); });
      pins.appendChild(p);
    }
    if (card && card.ghost) pins.appendChild(card.ghost);
  }
  function tick() {
    for (const p of pins.children) {
      const c = p.dataset.id ? findC(p.dataset.id) : p.__at;
      const pt = c && (p.__at ? p.__at() : pinPoint(c));
      if (pt) p.style.transform = `translate(${pt[0].toFixed(1)}px, ${pt[1].toFixed(1)}px)`;
      p.classList.toggle('open', !!(card && card.id === p.dataset.id));
    }
    if (navOpen) markCurrent();
    raf = requestAnimationFrame(tick);
  }
  function updateInbox() {
    const open = st.review.comments.filter(c => !c.resolved), need = open.filter(needs);
    inboxEl.querySelector('b').textContent = open.length;
    inboxEl.classList.toggle('need', need.length > 0);
    inboxEl.querySelector('.dk-need').textContent = need.length ? `${need.length} need${need.length > 1 ? '' : 's'} you` : '';
  }
  function nextComment() {
    if (!st) return;
    const open = st.review.comments.filter(c => !c.resolved);
    const list = open.filter(needs).length ? open.filter(needs) : open;
    if (!list.length) { toast('No open comments'); return; }
    const k = card && card.id ? (list.findIndex(c => c.id === card.id) + 1) % list.length : 0;
    const c = list[k], i = D.stations.findIndex(s => s.el.id === c.station);
    if (i >= 0 && i !== D.current()) D.goto(i);
    setTimeout(() => openThread(c), i !== D.current() ? 0 : 0);
  }

  /* ---------- cards ---------- */
  function place(el, x, y) {
    const w = el.offsetWidth, h = el.offsetHeight, m = 14;
    let L = x + 22, T = y - 26;
    if (L + w > innerWidth - m) L = x - w - 22;
    L = Math.max(m + (navOpen ? nav.offsetWidth : 0), Math.min(L, innerWidth - w - m));
    T = Math.max(66, Math.min(T, innerHeight - h - m));
    el.style.left = L + 'px'; el.style.top = T + 'px';
  }
  function closeCard() {
    if (!card) return;
    card.el.remove(); if (card.ghost) card.ghost.remove();
    card = null;
    if (pendingReload && !editing) reloadHere();
  }
  function stationName(id) { const s = byId(id); return s ? s.name || id : id; }

  function openCompose(s, local, anchor, x, y) {
    closeCard();
    const el = $('div', 'dk dk-card');
    el.innerHTML = `<header><span class="dk-id">New comment</span><span class="dk-where">${esc(stationName(s.el.id))} · <span class="dk-mono">${esc(s.el.id)}</span></span><button class="dk-x" aria-label="Cancel">${IC.close}</button></header>
      ${anchor ? `<div class="dk-anchor">${esc(anchor.text || anchor.selector)}</div>` : ''}
      <div class="dk-compose"><textarea placeholder="Tell the agent what to change…" aria-label="Comment"></textarea>
      <div class="dk-row"><span class="dk-hint">Enter posts · Shift+Enter new line · Esc cancels</span><button class="dk-btn primary" data-post>Post</button></div></div>`;
    document.body.appendChild(el); shield(el);
    const ghost = $('div', 'dk-pin ghost', '+');
    ghost.__at = () => { const r = s.el.getBoundingClientRect(); return [r.left + local.x / s.w * r.width, r.top + local.y / s.h * r.height]; };
    pins.appendChild(ghost);
    card = { kind: 'compose', el, ghost };
    place(el, x, y);
    const ta = el.querySelector('textarea'); ta.focus();
    const post = async () => {
      const text = ta.value.trim(); if (!text) return ta.focus();
      el.querySelector('[data-post]').disabled = true; status('saving', 'Saving…');
      const r = await api('comment', { station: s.el.id, at: local, anchor, text });
      if (!r.ok) { el.querySelector('[data-post]').disabled = false; status('error', 'Not saved'); return toast(r.error || 'Not saved', true); }
      status('saved', 'Saved'); closeCard();
      st.review.comments.push(r.comment); renderPins(); updateInbox();
      toast(`Comment ${r.comment.id} saved — the agent reads it from ${st.deck.replace(/\.html?$/, '')}.review.json`);
    };
    el.querySelector('[data-post]').onclick = post;
    el.querySelector('.dk-x').onclick = closeCard;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); post(); } });
  }

  function msgHTML(m, isRoot) {
    const role = m.role === 'agent' ? '<span class="dk-role">Agent</span>' : '';
    let h = `<div class="dk-msg"><div class="dk-who"><b>${esc(m.author || 'someone')}</b>${role}<span>${esc(ago(m.created))}</span></div><p>${esc(m.text)}</p>`;
    if (!isRoot && m.proposal) {
      const p = m.proposal, patch = p.patch;
      h += `<div class="dk-prop"><div class="dk-sum">${esc(p.summary || 'Proposed change')}</div>`;
      if (patch && typeof patch.find === 'string')
        h += `<div class="dk-diff"><div class="del">${esc(patch.find)}</div><div class="ins">${esc(patch.replace ?? '')}</div></div>`;
      if (!m.decision) {
        h += `<div class="dk-acts" data-reply="${esc(m.id)}">
          <button class="dk-btn primary" data-choice="apply">${patch ? 'Apply change' : 'Yes, do it'}</button>
          <button class="dk-btn" data-choice="keep">Keep as is</button>
          <button class="dk-btn" data-choice="other">Something else…</button></div>
          <div class="dk-other" data-for="${esc(m.id)}"><textarea placeholder="What should the agent do instead?"></textarea>
          <div class="dk-row"><span class="dk-hint">Sent to the agent as your decision</span><button class="dk-btn primary" data-send="${esc(m.id)}">Send</button></div></div>`;
      } else {
        const d = m.decision, word = { apply: 'Applied', keep: 'Kept as is', other: 'Asked for something else' }[d.choice];
        h += `<div class="dk-decided"><b>${word}</b><span>· ${esc(d.by)} · ${esc(ago(d.at))}</span></div>`;
        if (d.text) h += `<div class="dk-decided">“${esc(d.text)}”</div>`;
        if (d.applied === false) h += `<div class="dk-decided"><span class="dk-err">Not applied: ${esc(d.error)} — the agent will see this.</span></div>`;
        else if (d.choice === 'apply' && !d.applied) h += `<div class="dk-decided">No patch attached — the agent applies it on its next turn.</div>`;
      }
      h += '</div>';
    }
    return h + '</div>';
  }
  function openThread(c, keep) {
    let draft = '', focused = false;
    if (keep && card && card.kind === 'thread') { const t = card.el.querySelector('.dk-compose textarea'); draft = t.value; focused = document.activeElement === t; }
    const prevPos = keep && card ? [card.el.style.left, card.el.style.top] : null;
    if (!keep || !card) closeCard(); else card.el.remove();
    const el = $('div', 'dk dk-card');
    el.innerHTML = `<header><span class="dk-id">${esc(c.id)}</span><span class="dk-where">${esc(stationName(c.station))} · <span class="dk-mono">${esc(c.station)}</span>${c.resolved ? ' · resolved' : ''}</span><button class="dk-x" aria-label="Close">${IC.close}</button></header>
      <div class="dk-scroll">${c.anchor && c.anchor.text ? `<div class="dk-anchor">${esc(c.anchor.text)}</div>` : ''}
      ${msgHTML(c, true)}${(c.replies || []).map(r => msgHTML(r)).join('')}</div>
      <div class="dk-compose"><textarea placeholder="Reply…" aria-label="Reply"></textarea>
      <div class="dk-row"><button class="dk-btn" data-resolve>${c.resolved ? 'Reopen' : 'Resolve'}</button><span class="dk-hint"></span><button class="dk-btn primary" data-reply-send>Reply</button></div></div>`;
    document.body.appendChild(el); shield(el);
    card = { kind: 'thread', id: c.id, el };
    if (prevPos) { el.style.left = prevPos[0]; el.style.top = prevPos[1]; el.style.animation = 'none'; }
    else { const pt = pinPoint(c) || [innerWidth / 2, innerHeight / 2]; place(el, pt[0], pt[1]); }
    const ta = el.querySelector('.dk-compose textarea'); ta.value = draft; if (focused) ta.focus();
    el.querySelector('.dk-scroll').scrollTop = 1e6;
    el.querySelector('.dk-x').onclick = closeCard;
    const send = async () => {
      const text = ta.value.trim(); if (!text) return;
      const r = await api('reply', { comment: c.id, text });
      if (r.ok) ta.value = ''; else toast(r.error || 'Not saved', true);
    };
    el.querySelector('[data-reply-send]').onclick = send;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    el.querySelector('[data-resolve]').onclick = async () => {
      const r = await api('resolve', { comment: c.id, resolved: !c.resolved });
      if (!r.ok) return toast(r.error || 'Not saved', true);
      toast(c.resolved ? 'Reopened' : `Resolved — ${c.id} stays in the sidecar as history`);
      if (!c.resolved && !showResolved) closeCard();
    };
    el.querySelectorAll('[data-choice]').forEach(b => b.onclick = async () => {
      const rid = b.parentElement.dataset.reply;
      if (b.dataset.choice === 'other') { const o = el.querySelector(`.dk-other[data-for="${CSS.escape(rid)}"]`); o.classList.add('show'); o.querySelector('textarea').focus(); return; }
      decide(rid, b.dataset.choice, '');
    });
    el.querySelectorAll('[data-send]').forEach(b => b.onclick = () => {
      const t = el.querySelector(`.dk-other[data-for="${CSS.escape(b.dataset.send)}"] textarea`).value.trim();
      if (!t) return toast('Tell the agent what you want instead', true);
      decide(b.dataset.send, 'other', t);
    });
  }
  async function decide(rid, choice, text) {
    status('saving', 'Saving…');
    const r = await api('decide', { reply: rid, choice, text });
    if (!r.ok) { status('error', 'Not saved'); return toast(r.error || 'Not saved', true); }
    status('saved', 'Saved');
    if (r.decision.applied === false) toast('Recorded, but the patch did not apply: ' + r.decision.error, true);
    else toast(choice === 'apply' ? (r.decision.applied ? 'Applied to the deck' : 'Recorded — the agent applies it next turn') : 'Decision recorded for the agent');
    if (r.reload) { pendingReload = true; closeCard(); }
  }

  /* ---------- slide navigator ---------- */
  let io = null, dragId = null, dropAt = -1;
  const dropEl = $('div', 'dk-drop');
  function renderNav(soft) {
    if (!st) return;
    const order = st.order;
    nav.querySelector('h2 span').textContent = String(order.length).padStart(2, '0');
    const counts = {}; st.review.comments.forEach(c => { if (!c.resolved) counts[c.station] = (counts[c.station] || 0) + 1; });
    if (soft && listEl.children.length === order.length && [...listEl.children].every((n, k) => n.dataset.id === order[k].id)) {
      [...listEl.children].forEach(n => { const b = n.querySelector('.dk-cc'), k = counts[n.dataset.id]; b.textContent = k || ''; b.style.display = k ? '' : 'none'; });
      return;
    }
    listEl.textContent = '';
    if (io) io.disconnect();
    io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const f = e.target.querySelector('iframe'); if (!f.src) f.src = f.dataset.src; io.unobserve(e.target); } }), { root: listEl, rootMargin: '200px' });
    order.forEach((o, k) => {
      const n = $('div', 'dk-slide'); n.dataset.id = o.id; n.draggable = true; n.tabIndex = 0;
      n.setAttribute('aria-label', `${k + 1}: ${o.name}`);
      n.innerHTML = `<div class="dk-num">${String(k + 1).padStart(2, '0')}</div><div class="dk-thumb"><iframe tabindex="-1" loading="lazy" title="${esc(o.name)}"></iframe></div>
        <div class="dk-meta"><span class="dk-name">${esc(o.name)}</span><span class="dk-sid">${esc(o.id)}</span><span class="dk-cc" style="${counts[o.id] ? '' : 'display:none'}">${counts[o.id] || ''}</span></div>`;
      const f = n.querySelector('iframe');
      f.dataset.src = `${location.pathname}?still=1&dk=thumb#${encodeURIComponent(o.id)}`;
      f.onload = () => setTimeout(() => f.classList.add('ready'), 350);
      n.addEventListener('click', () => { const i = D.stations.findIndex(s => s.el.id === o.id); if (i >= 0 && !D.isBusy()) D.goto(i); });
      n.addEventListener('dragstart', e => { dragId = o.id; n.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); });
      n.addEventListener('dragend', () => { n.classList.remove('dragging'); dropEl.remove(); dragId = null; });
      listEl.appendChild(n); io.observe(n);
    });
    scaleThumbs(); markCurrent(true);
  }
  function scaleThumbs() {
    const t = listEl.querySelector('.dk-thumb'); if (!t) return;
    const k = t.clientWidth / 1920;
    listEl.querySelectorAll('.dk-thumb iframe').forEach(f => { f.style.transform = `scale(${k})`; });
  }
  let lastCur = -1;
  function markCurrent(force) {
    const i = D.current(); if (i === lastCur && !force) return; lastCur = i;
    const id = D.stations[i].el.id;
    listEl.querySelectorAll('.dk-slide').forEach(n => n.classList.toggle('current', n.dataset.id === id));
    const cur = listEl.querySelector('.dk-slide.current');
    if (cur && !force) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function reloadThumb(id) {
    const f = listEl.querySelector(`.dk-slide[data-id="${CSS.escape(id)}"] iframe`);
    if (f && f.src) { f.classList.remove('ready'); f.src = f.dataset.src.replace('?still=1', `?still=1&v=${Date.now()}`); }
  }
  listEl.addEventListener('dragover', e => {
    if (!dragId) return; e.preventDefault();
    const items = [...listEl.querySelectorAll('.dk-slide')];
    dropAt = items.findIndex(n => { const r = n.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (dropAt < 0) dropAt = items.length;
    const ref = items[dropAt];
    if (ref) listEl.insertBefore(dropEl, ref); else listEl.appendChild(dropEl);
  });
  listEl.addEventListener('drop', e => {
    if (!dragId) return; e.preventDefault();
    const order = st.order.map(o => o.id), from = order.indexOf(dragId);
    let to = dropAt; if (to > from) to--;
    dropEl.remove();
    move(from, to);
  });
  listEl.addEventListener('keydown', e => {           // keyboard reorder: Alt+↑/↓ on a focused slide
    const n = e.target.closest('.dk-slide'); if (!n) return;
    const order = st.order.map(o => o.id), from = order.indexOf(n.dataset.id);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(from, from + (e.key === 'ArrowUp' ? -1 : 1)); }
    else if (e.key === 'Enter') n.click();
  });
  async function move(from, to) {
    const order = st.order.map(o => o.id);
    if (to < 0 || to >= order.length || to === from) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    status('saving', 'Saving…');
    const r = await api('reorder', { order });
    if (!r.ok) { status('error', 'Not saved'); return toast(r.error || 'Reorder failed', true); }
    // The engine reads positions once at boot: the relaid staircase needs a fresh page.
    session.set({ on, tool, navOpen, showResolved, toast: 'Reordered — every station was relaid on the staircase' });
    reloadHere();
  }

  /* ---------- pointer: text + comment tools ---------- */
  function stationAt(x, y) {
    for (const s of D.stations) { const r = s.el.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { s, r }; }
    return null;
  }
  window.addEventListener('click', e => {
    if (!on || e.target.closest('.dk') || D.isOverview()) return;
    if (tool === 'text') {
      const el = e.target.closest('.dk-editable');
      if (editing && editing.el.contains(e.target)) return;         // moving the caret
      if (el && el.__dkUnit) { e.preventDefault(); e.stopPropagation(); beginEdit(el, e); }
    } else if (tool === 'comment') {
      const hit = stationAt(e.clientX, e.clientY); if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      const { s, r } = hit;
      const local = { x: (e.clientX - r.left) / r.width * s.w, y: (e.clientY - r.top) / r.height * s.h };
      let anchor = null;
      const t = e.target !== s.el && s.el.contains(e.target) ? lift(e.target, s.el) : null;
      if (t) {
        const ar = t.getBoundingClientRect();
        anchor = { selector: selectorFor(t, s.el), text: (t.__dkUnit ? t.__dkUnit.text : t.textContent || t.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                   offset: { x: +((e.clientX - ar.left) / (ar.width || 1)).toFixed(3), y: +((e.clientY - ar.top) / (ar.height || 1)).toFixed(3) } };
      }
      openCompose(s, local, anchor, e.clientX, e.clientY);
    }
  }, true);
  document.addEventListener('mousedown', e => {      // a click outside an open card closes it
    if (card && !card.el.contains(e.target) && !e.target.closest('.dk-pin') && !(tool === 'comment' && !e.target.closest('.dk'))) {
      if (card.kind === 'compose' && card.el.querySelector('textarea').value.trim()) return;   // never drop a draft
      closeCard();
    }
  });

  /* ---------- keys ---------- */
  window.addEventListener('keydown', e => {
    const chord = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyE';
    if (chord) { e.preventDefault(); e.stopImmediatePropagation(); setOn(!on); return; }
    if (!on) return;
    if (editing && editing.el.contains(e.target)) {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { e.preventDefault(); commitEdit(true); }
      else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (e.shiftKey || isHeading(editing.el)) document.execCommand('insertLineBreak');
        else editing.el.blur();
      }
      else if ((e.metaKey || e.ctrlKey) && /^[biu]$/i.test(e.key)) e.preventDefault();   // formatting = structure
      return;
    }
    if (e.target.closest && e.target.closest('.dk')) return;   // shield() handles our own UI
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' && card) { e.preventDefault(); e.stopImmediatePropagation(); closeCard(); }
    else if (k === 't') setTool(tool === 'text' ? null : 'text');
    else if (k === 'c') setTool(tool === 'comment' ? null : 'comment');
    else if (k === 'n') setNav(!navOpen);
    else if (k === 'r') { showResolved = !showResolved; renderPins(); persist(); toast(showResolved ? 'Showing resolved comments' : 'Hiding resolved comments'); }
  }, true);
  document.addEventListener('focusout', e => { if (editing && e.target === editing.el) commitEdit(false); });
  document.addEventListener('paste', e => {          // plain text only: pasted markup is structure
    if (!editing || !editing.el.contains(e.target)) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' '));
  });
  document.addEventListener('drop', e => { if (editing && editing.el.contains(e.target)) e.preventDefault(); });

  // A caret near the frame's edge makes the browser scroll #viewport to reveal it — overflow:
  // hidden stops the user, not the browser — which shifts the whole stage off the camera.
  // The camera is the only thing that moves the world: pin the scroll at 0.
  D.viewport.addEventListener('scroll', () => { if (D.viewport.scrollTop || D.viewport.scrollLeft) D.viewport.scrollTop = D.viewport.scrollLeft = 0; });

  // A presentation owns the screen: entering full screen turns edit mode off.
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => { if (D.isPresenting() && on) setOn(false); }));
  window.addEventListener('resize', () => { if (navOpen) scaleThumbs(); });

  /* ---------- boot ---------- */
  const saved = session.get();
  tool = saved.tool !== undefined ? saved.tool : 'text';
  navOpen = !!saved.navOpen; showResolved = !!saved.showResolved;
  if (Q.get('edit') === '1' || saved.on) setOn(true);
  if (saved.toast) { toast(saved.toast); session.set({ ...saved, toast: undefined }); }
})();
