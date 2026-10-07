(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const pathRoom = location.pathname.startsWith('/raum/') ? decodeURIComponent(location.pathname.split('/')[2] || '') : '';
  const room = pathRoom || params.get('raum') || params.get('room') || '';
  const partnerOnly = location.pathname === '/partner';
  const noRotate = params.get('rotate') === '0';
  const nowParam = params.get('now');
  const CACHE_KEY = 'agenda-state:' + room;
  const POLL_MS = 10000, FETCH_TIMEOUT_MS = 6000;

  let partnerShown = false;
  let data = null;                 // letzter Stand (Server oder Zwischenspeicher)
  let serverBaseMs = null;         // Serverzeit (naiv, Europe/Berlin) beim letzten Abruf
  let serverPerf = 0;              // performance.now() beim letzten Abruf
  let online = false, loading = false;
  let dataSig = '', viewSig = '', view = null;
  const rotationStart = performance.now();

  const naiveMs = (s) => Date.parse(s + 'Z');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hm = (ms) => new Date(ms).toISOString().substr(11, 5);

  // Berlin-Zeit der PC-Uhr als "naive" Millisekunden (wie naiveMs der Server-Zeitstempel)
  const BERLIN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function pcBerlinMs() {
    const p = Object.fromEntries(BERLIN.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return naiveMs(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);
  }
  // Vorrang: Serverzeit (fortgeschrieben mit monotoner Uhr). Nur ohne jeden Serverkontakt: PC-Uhr.
  const curMs = () => (serverBaseMs != null ? serverBaseMs + (performance.now() - serverPerf) : pcBerlinMs());

  // ---------- Daten holen ----------
  async function load() {
    if (loading) return;
    loading = true;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const q = new URLSearchParams({ room });
      if (nowParam) q.set('now', nowParam);
      const t0 = performance.now();
      const r = await fetch('/api/state?' + q, { cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      const t1 = performance.now();
      serverBaseMs = naiveMs(s.now) + (t1 - t0) / 2;
      serverPerf = t1;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {}
      setOnline(true);
      applyData(s);
    } catch {
      setOnline(false);
      if (!data) {
        try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c && c.items) applyData(c); } catch {}
      }
    } finally {
      clearTimeout(to); loading = false;
    }
  }

  function setOnline(v) {
    online = v;
    $('net').hidden = v;
  }

  // ---------- Status aus Uhrzeit berechnen (wie auf dem Server) ----------
  function compute(d, ms) {
    const items = d.items.map((it) => {
      const a = naiveMs(it.startTs), b = naiveMs(it.endTs);
      return { ...it, status: ms >= b ? 'past' : ms >= a ? 'current' : 'upcoming' };
    });
    const cur = items.filter((i) => i.status === 'current');
    const current = cur.find((i) => i.type !== 'break') || cur[0] || null;
    const upcoming = items.filter((i) => i.status === 'upcoming');
    const next = upcoming.find((i) => i.type !== 'break' && i.id !== current?.id) || null;
    for (const i of items) if (i.status === 'current' && i !== current) i.status = 'current-secondary';
    const phase = !items.length ? 'empty' : current ? 'live' : upcoming.length ? (items.some((i) => i.status === 'past') ? 'between' : 'before') : 'after';
    return { ...d, items, currentId: current?.id ?? null, nextId: next?.id ?? null, phase };
  }

  function applyData(s) {
    data = s;
    document.documentElement.style.setProperty('--accent', s.settings.accent || '#005498');
    document.title = (s.settings.title || 'Agenda') + (s.room ? ' – ' + s.room.name : '');
    $('subtitle').textContent = s.settings.subtitle;
    for (const [id, f] of [['logo1', s.settings.logo1], ['logo2', s.settings.logo2]]) {
      const img = $(id);
      if (f) { const u = '/uploads/' + f; if (img.getAttribute('src') !== u) img.src = u; img.hidden = false; } else img.hidden = true;
    }
    $('title').textContent = s.settings.title;
    $('title').hidden = !!s.settings.logo1;
    setHeadline(partnerShown, s);
    const sig = JSON.stringify([s.partners, s.settings, s.room, s.rooms]);
    if (sig !== dataSig) { dataSig = sig; renderPartners(s); }
    refreshView();
  }

  function refreshView() {
    if (!data) return;
    view = compute(data, curMs());
    const sig = JSON.stringify([data.items, view.items.map((i) => i.status), view.currentId, view.nextId, view.phase]);
    if (sig === viewSig) return;
    viewSig = sig;
    renderAgenda(view);
  }

  function setHeadline(partner, s) {
    s = s || data; if (!s) return;
    $('hl1').textContent = partner ? (s.settings.partners_title || 'Die Partner der Veranstaltung') : 'Programm';
    $('hl2').textContent = partner ? '' : (s.room ? s.room.name : '');
  }

  function itemFocus(parent, it) {
    parent.append(el('div', 'time', `${it.start} – ${it.end} Uhr`));
    parent.append(el('div', 'f-title', it.title));
    if (it.speaker || it.company) {
      const sp = el('div', 'f-speaker');
      if (it.speaker) sp.append(el('b', '', it.speaker));
      if (it.company) { sp.append(document.createTextNode((it.speaker ? ' · ' : '') + it.company)); }
      parent.append(sp);
    }
    if (it.description) parent.append(el('div', 'f-desc', it.description));
    if (it.elsewhere) parent.append(el('div', 'f-elsewhere', `Findet statt: ${it.elsewhere}`));
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
    else xb.append(el('div', 'empty', 'Keine weiteren Programmpunkte.'));

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

  function fit(el, min, probe) {
    probe = probe || el;
    el.style.setProperty('--k', 1);
    let k = 1;
    while (probe.scrollHeight > probe.clientHeight + 1 && k > min) { k = +(k - 0.04).toFixed(2); el.style.setProperty('--k', k); }
  }
  function fitAll() {
    if ($('agendaView').hidden) return;
    fit($('nowCard'), 0.5, $('nowBody')); fit($('nextCard'), 0.5); fit($('list'), 0.5);
  }
  window.addEventListener('resize', () => { if (data) renderPartners(data); fitAll(); scrollToCurrent(); });

  function scrollToCurrent() {
    const list = $('list');
    const t = list.querySelector('li.current') || list.querySelector('li.next');
    if (!t || !list.clientHeight) return;
    list.scrollTo({ top: Math.max(0, t.offsetTop - list.offsetTop - list.clientHeight * 0.18), behavior: 'smooth' });
  }

  function renderPartners(s) {
    const g = $('partnerGrid'); g.replaceChildren();
    const n = s.partners.length;
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const cols = portrait ? 2 : n <= 3 ? Math.max(n, 1) : n <= 12 ? 4 : 5;
    const rows = Math.ceil(n / cols) || 1;
    g.style.setProperty('--cols', cols);
    s.partners.forEach((p, i) => {
      const c = el('div', 'p-card' + ((i + 1) % cols === 0 || i === n - 1 ? ' edge' : '') + (i >= (rows - 1) * cols ? ' last' : ''));
      const im = el('div', 'img');
      if (p.logo) { const i2 = el('img'); i2.src = '/uploads/' + p.logo; i2.alt = p.name; im.append(i2); }
      c.append(im, el('div', 'nm', p.name));
      if (p.category) c.append(el('div', 'cat', p.category));
      g.append(c);
    });
  }

  function tick() {
    if (!data) return;
    const ms = curMs();
    $('clock').textContent = hm(ms);
    refreshView();
    const cur = view && view.items.find((i) => i.id === view.currentId);
    if (cur) {
      const a = naiveMs(cur.startTs), b = naiveMs(cur.endTs);
      $('progress').style.width = Math.max(0, Math.min(100, ((ms - a) / (b - a)) * 100)) + '%';
    }
    // Wechsel Agenda <-> Partner
    const hasPartners = data.settings.partners_enabled && data.partners.length > 0;
    let showPartners = false;
    if (partnerOnly) showPartners = true;
    else if (hasPartners && !noRotate) {
      const A = data.settings.rotate_agenda_sec * 1000, P = data.settings.rotate_partner_sec * 1000;
      showPartners = ((performance.now() - rotationStart) % (A + P)) >= A;
    }
    const wasHidden = $('agendaView').hidden;
    if (showPartners !== partnerShown) { partnerShown = showPartners; setHeadline(partnerShown); }
    $('agendaView').hidden = showPartners;
    if (wasHidden && !showPartners) { fitAll(); scrollToCurrent(); requestAnimationFrame(() => { fitAll(); scrollToCurrent(); }); }
    $('partnerView').hidden = !showPartners;
  }

  // Zwischenspeicher für Neustart ohne Netz (nur in sicherem Kontext: https oder localhost)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  load();
  setInterval(load, POLL_MS);
  setInterval(tick, 1000);
  tick();
})();
