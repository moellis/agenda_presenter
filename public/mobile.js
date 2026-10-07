(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const nowParam = params.get('now');
  const CACHE_KEY = 'agenda-mobile';
  const POLL_MS = 20000, FETCH_TIMEOUT_MS = 8000;

  let data = null, serverBaseMs = null, serverPerf = 0, loading = false, sig = '', firstRender = true;

  const naiveMs = (s) => Date.parse(s + 'Z');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const BERLIN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function pcBerlinMs() {
    const p = Object.fromEntries(BERLIN.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return naiveMs(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);
  }
  // Vorrang: Serverzeit (fortgeschrieben). Ohne Serverkontakt: Uhr des Geräts.
  const curMs = () => (serverBaseMs != null ? serverBaseMs + (performance.now() - serverPerf) : pcBerlinMs());

  async function load() {
    if (loading) return;
    loading = true;
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const q = new URLSearchParams(); if (nowParam) q.set('now', nowParam);
      const t0 = performance.now();
      const r = await fetch('/api/state?' + q, { cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json(); const t1 = performance.now();
      serverBaseMs = naiveMs(s.now) + (t1 - t0) / 2; serverPerf = t1;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {}
      $('net').hidden = true; setData(s);
    } catch {
      $('net').hidden = false;
      if (!data) { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c && c.items) setData(c); } catch {} }
    } finally { clearTimeout(to); loading = false; }
  }

  function setData(s) {
    data = s;
    document.documentElement.style.setProperty('--accent', s.settings.accent || '#005498');
    document.title = (s.settings.title || 'Programm');
    $('subtitle').textContent = s.settings.subtitle;
    for (const [id, f] of [['logo1', s.settings.logo1], ['logo2', s.settings.logo2]]) {
      const img = $(id);
      if (f) { const u = '/uploads/' + f; if (img.getAttribute('src') !== u) img.src = u; img.hidden = false; } else img.hidden = true;
    }
    $('title').textContent = s.settings.title; $('title').hidden = !!s.settings.logo1;
    renderPartners(s);
    refresh();
  }

  // Zeitfenster bilden und nach Uhrzeit bewerten
  function slotsFor(d, ms) {
    const roomIdx = (it) => { const i = d.rooms.findIndex((r) => r.slug === it.roomSlugs[0]); return i < 0 ? 99 : i; };
    const map = new Map();
    for (const it of d.items) {
      const k = `${it.date}|${it.start}|${it.end}`;
      if (!map.has(k)) map.set(k, { key: k, date: it.date, start: it.start, end: it.end, startMs: naiveMs(it.startTs), endMs: naiveMs(it.endTs), items: [] });
      map.get(k).items.push(it);
    }
    const slots = [...map.values()].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    for (const s of slots) {
      s.items.sort((a, b) => roomIdx(a) - roomIdx(b));
      s.status = ms >= s.endMs ? 'past' : ms >= s.startMs ? 'current' : 'upcoming';
      s.allBreak = s.items.every((i) => i.type === 'break');
    }
    const nxt = slots.find((s) => s.status === 'upcoming' && !s.allBreak);
    if (nxt) nxt.status = 'next';
    return slots;
  }

  function refresh() {
    if (!data) return;
    const slots = slotsFor(data, curMs());
    const nsig = JSON.stringify([data.items, slots.map((s) => s.status)]);
    if (nsig === sig) return;
    sig = nsig; render(slots);
  }

  function itemNode(it) {
    const brk = it.type === 'break';
    const room = it.scope === 'all' ? (brk ? '' : 'Alle Räume') : it.roomNames.join(' · ');
    const head = el('div');
    if (room) head.append(el('div', 'room', room));
    head.append(el('div', 'ttl', it.title));
    const who = [it.speaker, it.company].filter(Boolean).join(' · ');
    if (who) head.append(el('div', 'who', who));
    const wrap = el('div', 'it' + (brk ? ' brk' : ''));
    if (it.description) {
      const d = el('details'); const sm = el('summary'); sm.append(head, el('span', 'more', 'Mehr anzeigen'));
      d.append(sm, el('div', 'desc', it.description)); wrap.append(d);
    } else wrap.append(head);
    return wrap;
  }

  function render(slots) {
    const root = $('slots'); root.replaceChildren();
    const dates = new Set(slots.map((s) => s.date)); let lastDate = null;
    const open = new Set([...document.querySelectorAll('details[open] .ttl')].map((n) => n.textContent));
    for (const s of slots) {
      if (dates.size > 1 && s.date !== lastDate) {
        root.append(el('div', 'day', new Date(s.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })));
        lastDate = s.date;
      }
      const sec = el('section', 'slot ' + s.status);
      const head = el('div', 'slot-head');
      head.append(el('div', 'slot-time', `${s.start} – ${s.end}`));
      const flag = s.status === 'current' ? (s.allBreak ? 'Aktuell' : 'Jetzt') : s.status === 'next' ? 'Als Nächstes' : '';
      if (flag) head.append(el('div', 'slot-flag', flag));
      sec.append(head);
      for (const it of s.items) {
        const n = itemNode(it); sec.append(n);
        const d = n.querySelector('details'); if (d && open.has(it.title)) d.open = true;
      }
      root.append(sec);
    }
    updateJump();
    if (firstRender && slots.length) {
      firstRender = false;
      const t = root.querySelector('.slot.current') || root.querySelector('.slot.next');
      if (t) requestAnimationFrame(() => t.scrollIntoView({ block: 'start' }));
    }
  }

  function renderPartners(s) {
    const box = $('partners'), g = $('partnerGrid'); g.replaceChildren();
    if (!s.settings.partners_enabled || !s.partners.length) { box.hidden = true; return; }
    $('partnersTitle').textContent = s.settings.partners_title || 'Die Partner der Veranstaltung';
    for (const p of s.partners) {
      const c = el('div', 'p');
      if (p.logo) { const i = el('img'); i.src = '/uploads/' + p.logo; i.alt = p.name; i.loading = 'lazy'; c.append(i); } else c.append(el('span', '', p.name));
      g.append(c);
    }
    box.hidden = false;
  }

  function updateJump() {
    const t = document.querySelector('.slot.current') || document.querySelector('.slot.next');
    const btn = $('jump');
    if (!t) { btn.hidden = true; return; }
    const r = t.getBoundingClientRect();
    btn.hidden = r.bottom > 0 && r.top < innerHeight;
  }
  $('jump').addEventListener('click', () => {
    const t = document.querySelector('.slot.current') || document.querySelector('.slot.next');
    if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  addEventListener('scroll', updateJump, { passive: true });
  addEventListener('resize', updateJump);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { load(); refresh(); } });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  load();
  setInterval(load, POLL_MS);
  setInterval(refresh, 1000);
})();
