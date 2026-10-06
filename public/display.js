(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const pathRoom = location.pathname.startsWith('/raum/') ? decodeURIComponent(location.pathname.split('/')[2] || '') : '';
  const room = pathRoom || params.get('raum') || params.get('room') || '';
  const partnerOnly = location.pathname === '/partner';
  const noRotate = params.get('rotate') === '0';
  const nowParam = params.get('now');
  const CACHE_KEY = 'agenda-state:' + room;

  let state = null, fetchedAt = 0, baseMs = 0, rotationStart = Date.now(), lastSig = '';

  const naiveMs = (s) => Date.parse(s + 'Z');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hm = (ms) => new Date(ms).toISOString().substr(11, 5);
  const curMs = () => baseMs + (Date.now() - fetchedAt);

  async function load() {
    try {
      const q = new URLSearchParams({ room });
      if (nowParam) q.set('now', nowParam);
      const r = await fetch('/api/state?' + q, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {}
      apply(s, true);
      $('offline').hidden = true;
    } catch {
      if (!state) { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c) apply(c, false); } catch {} }
      $('offline').hidden = !state;
    }
  }

  function apply(s, fresh) {
    state = s;
    if (fresh) { baseMs = naiveMs(s.now); fetchedAt = Date.now(); }
    document.documentElement.style.setProperty('--accent', s.settings.accent || '#00589b');
    document.title = (s.settings.title || 'Agenda') + (s.room ? ' – ' + s.room.name : '');
    $('title').textContent = s.settings.title;
    $('subtitle').textContent = s.settings.subtitle;
    for (const [id, f] of [['logo1', s.settings.logo1], ['logo2', s.settings.logo2]]) {
      const img = $(id);
      if (f) { const u = '/uploads/' + f; if (img.getAttribute('src') !== u) img.src = u; img.hidden = false; } else img.hidden = true;
    }
    $('roomBadge').textContent = s.room ? s.room.name : '';
    const sig = JSON.stringify([s.items, s.currentId, s.nextId, s.phase, s.partners, s.settings, s.room]);
    if (sig === lastSig) return;
    lastSig = sig;
    renderAgenda(s);
    renderPartners(s);
  }

  function itemFocus(parent, it) {
    parent.append(el('div', 'time', `${it.start} – ${it.end} Uhr`));
    parent.append(el('div', 'f-title', it.title));
    if (it.speaker || it.company) {
      const sp = el('div', 'f-speaker', it.speaker || '');
      if (it.company) { const c = el('small', '', (it.speaker ? ' · ' : '') + it.company); sp.append(c); }
      parent.append(sp);
    }
    if (it.description) parent.append(el('div', 'f-desc', it.description));
    if (it.elsewhere) parent.append(el('div', 'f-elsewhere', `📍 findet in „${it.elsewhere}“ statt`));
  }

  function renderAgenda(s) {
    if (room && !s.room) {
      $('nowBody').replaceChildren(el('div', 'empty', `Raum „${room}“ nicht gefunden.`));
      $('nextBody').replaceChildren(el('div', 'empty', 'Verfügbar: ' + s.rooms.map((r) => r.slug).join(', ')));
      $('list').replaceChildren();
      return;
    }
    const byId = (id) => s.items.find((i) => i.id === id);
    const cur = byId(s.currentId), next = byId(s.nextId);
    const nowCard = $('nowCard'), nb = $('nowBody'), xb = $('nextBody');
    nb.replaceChildren(); xb.replaceChildren();
    nowCard.classList.toggle('live', !!cur);
    $('nowLabel').textContent = cur ? (cur.type === 'break' ? 'Aktuell' : 'Jetzt') : 'Jetzt';
    if (cur) itemFocus(nb, cur);
    else if (s.phase === 'before') {
      const first = s.items[0];
      nb.append(el('div', 'empty', first ? `Das Programm beginnt um ${first.start} Uhr.` : 'Noch kein Programm.'));
    } else if (s.phase === 'after') nb.append(el('div', 'empty', 'Vielen Dank für Ihren Besuch!'));
    else nb.append(el('div', 'empty', 'Gerade läuft kein Programmpunkt.'));
    if (next) itemFocus(xb, next);
    else xb.append(el('div', 'empty', s.phase === 'after' ? '—' : 'Keine weiteren Programmpunkte.'));

    const list = $('list'); list.replaceChildren();
    for (const it of s.items) {
      const li = el('li', [it.type === 'break' ? 'break' : '', it.status, it.id === s.nextId ? 'next' : ''].join(' ').trim());
      li.append(el('div', 't', `${it.start} – ${it.end}`));
      const body = el('div');
      const ti = el('div', 'ti', it.title);
      if (it.elsewhere) ti.append(el('span', 'el', it.elsewhere));
      body.append(ti);
      const sp = [it.speaker, it.company].filter(Boolean).join(' · ');
      if (sp) body.append(el('div', 'sp', sp));
      li.append(body); list.append(li);
    }
    nowCard.classList.toggle('idle', !cur);
    requestAnimationFrame(() => { fitAll(); scrollToCurrent(); });
  }

  function fit(el, min) {
    el.style.setProperty('--k', 1);
    let k = 1;
    while (el.scrollHeight > el.clientHeight + 1 && k > min) { k = +(k - 0.04).toFixed(2); el.style.setProperty('--k', k); }
  }
  function fitAll() {
    if ($('agendaView').hidden) return;
    fit($('nowCard'), 0.5); fit($('nextCard'), 0.5); fit($('list'), 0.5);
  }
  window.addEventListener('resize', () => { fitAll(); scrollToCurrent(); });

  function scrollToCurrent() {
    const list = $('list');
    const t = list.querySelector('li.current') || list.querySelector('li.next');
    if (!t || !list.clientHeight) return;
    list.scrollTo({ top: Math.max(0, t.offsetTop - list.offsetTop - list.clientHeight * 0.18), behavior: 'smooth' });
  }

  function renderPartners(s) {
    $('partnerTitle').textContent = s.settings.partners_title || 'Die Partner der Veranstaltung';
    const g = $('partnerGrid'); g.replaceChildren();
    const n = s.partners.length;
    g.style.setProperty('--cols', n <= 3 ? n || 1 : n <= 8 ? 4 : n <= 12 ? 4 : 5);
    for (const p of s.partners) {
      const c = el('div', 'p-card');
      const im = el('div', 'img');
      if (p.logo) { const i = el('img'); i.src = '/uploads/' + p.logo; i.alt = p.name; im.append(i); }
      c.append(im, el('div', 'nm', p.name));
      g.append(c);
    }
  }

  function tick() {
    if (!state) return;
    const ms = curMs();
    $('clock').textContent = hm(ms);
    const cur = state.items.find((i) => i.id === state.currentId);
    if (cur) {
      const a = naiveMs(cur.startTs), b = naiveMs(cur.endTs);
      $('progress').style.width = Math.max(0, Math.min(100, ((ms - a) / (b - a)) * 100)) + '%';
    }
    // Wechsel Agenda <-> Partner
    const hasPartners = state.settings.partners_enabled && state.partners.length > 0;
    let showPartners = false;
    if (partnerOnly) showPartners = true;
    else if (hasPartners && !noRotate) {
      const A = state.settings.rotate_agenda_sec * 1000, P = state.settings.rotate_partner_sec * 1000;
      showPartners = ((Date.now() - rotationStart) % (A + P)) >= A;
    }
    const wasHidden = $('agendaView').hidden;
    $('agendaView').hidden = showPartners;
    if (wasHidden && !showPartners) { fitAll(); scrollToCurrent(); }
    $('partnerView').hidden = !showPartners;
  }

  load();
  setInterval(load, 10000);
  setInterval(tick, 1000);
  tick();
})();
