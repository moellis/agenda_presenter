(() => {
  const $ = (id) => document.getElementById(id);
  let data = null, currentTab = 'event';

  // ---- Helfer ----
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }
  function toast(msg, bad) {
    const t = $('toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }
  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); throw new Error('Bitte erneut anmelden'); }
    if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
    return j;
  }
  const act = (fn, okMsg = 'Gespeichert') => async (ev) => {
    try { await fn(ev); if (okMsg) toast(okMsg); await refresh(); } catch (e) { toast(e.message, true); }
  };
  const logoUrl = (f) => (f ? '/uploads/' + f : '');
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  function dialog(title, fields, onSave) {
    const form = $('dlgForm'); form.replaceChildren();
    const err = h('p', { class: 'err' });
    form.append(h('h2', {}, title), ...fields, err,
      h('div', { class: 'actions' },
        h('button', { class: 'primary', type: 'submit', value: 'ok' }, 'Speichern'),
        h('button', { class: 'ghost', type: 'button', onclick: () => $('dlg').close() }, 'Abbrechen')));
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      try { await onSave(); $('dlg').close(); toast('Gespeichert'); await refresh(); } catch (e) { err.textContent = e.message; }
    };
    $('dlg').showModal();
  }

  // ---- Login ----
  function showLogin() { $('admin').hidden = true; $('login').hidden = false; }
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('POST', '/api/login', { password: $('pw').value }); $('pw').value = ''; $('loginErr').textContent = ''; await start(); }
    catch (e) { $('loginErr').textContent = e.message; }
  });
  $('logout').addEventListener('click', async () => { await api('POST', '/api/logout'); showLogin(); });
  $('tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    currentTab = b.dataset.tab; render();
  });

  async function refresh() { data = await api('GET', '/api/admin/all'); render(); }
  async function start() {
    const me = await fetch('/api/me').then((r) => r.json());
    if (!me.authed) return showLogin();
    $('login').hidden = true; $('admin').hidden = false;
    await refresh();
  }

  function render() {
    if (!data) return;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
    for (const t of ['event', 'rooms', 'items', 'partners', 'links']) $('tab-' + t).hidden = t !== currentTab;
    // Tab-Inhalt nur neu aufbauen, wenn aktiv (erhält Eingaben der anderen Tabs nicht – nicht nötig)
    ({ event: renderEvent, rooms: renderRooms, items: renderItems, partners: renderPartners, links: renderLinks })[currentTab]();
    $('hTitle').textContent = data.settings.title || 'Agenda-Presenter';
  }

  // ---- Veranstaltung ----
  function logoBox(slot, file) {
    const input = h('input', { type: 'file', accept: 'image/*' });
    return h('div', {},
      h('label', {}, `Logo ${slot}`),
      h('div', { class: 'logo-prev' }, file ? h('img', { src: logoUrl(file), alt: '' }) : h('span', { class: 'hint' }, 'Kein Logo')),
      h('div', { class: 'actions' }, input,
        h('button', { class: 'ghost', type: 'button', onclick: act(async () => {
          if (!input.files[0]) throw new Error('Bitte zuerst eine Datei wählen');
          const fd = new FormData(); fd.append('file', input.files[0]); await api('POST', `/api/admin/logo/${slot}`, fd);
        }, 'Logo hochgeladen') }, 'Hochladen'),
        file && h('button', { class: 'danger', type: 'button', onclick: act(() => api('DELETE', `/api/admin/logo/${slot}`), 'Logo entfernt') }, 'Entfernen')));
  }
  function renderEvent() {
    const s = data.settings, root = $('tab-event'); root.replaceChildren();
    const f = {
      title: h('input', { value: s.title }), subtitle: h('input', { value: s.subtitle }),
      event_date: h('input', { type: 'date', value: s.event_date }), accent: h('input', { type: 'color', value: s.accent }),
      partners_enabled: h('input', { type: 'checkbox', checked: s.partners_enabled === '1' }),
      partners_title: h('input', { value: s.partners_title }),
      rotate_agenda_sec: h('input', { type: 'number', min: 5, max: 600, value: s.rotate_agenda_sec }),
      rotate_partner_sec: h('input', { type: 'number', min: 5, max: 600, value: s.rotate_partner_sec }),
    };
    root.append(
      h('div', { class: 'panel' }, h('h2', {}, 'Veranstaltung'),
        h('label', {}, 'Veranstaltungstitel', f.title),
        h('label', {}, 'Untertitel (z. B. Datum und Ort)', f.subtitle),
        h('div', { class: 'row' },
          h('label', {}, 'Veranstaltungsdatum (Vorgabe für neue Programmpunkte)', f.event_date),
          h('label', {}, 'Akzentfarbe', f.accent)),
        h('h3', {}, 'Partner-Seite'),
        h('label', {}, f.partners_enabled, 'Partner-Seite aktivieren (wechselt automatisch mit der Agenda)'),
        h('label', {}, 'Überschrift der Partner-Seite', f.partners_title),
        h('div', { class: 'row' },
          h('label', {}, 'Agenda anzeigen für (Sekunden)', f.rotate_agenda_sec),
          h('label', {}, 'Partner anzeigen für (Sekunden)', f.rotate_partner_sec)),
        h('button', { class: 'primary', onclick: act(() => api('PUT', '/api/admin/settings', {
          title: f.title.value, subtitle: f.subtitle.value, event_date: f.event_date.value, accent: f.accent.value,
          partners_enabled: f.partners_enabled.checked ? '1' : '0', partners_title: f.partners_title.value,
          rotate_agenda_sec: f.rotate_agenda_sec.value, rotate_partner_sec: f.rotate_partner_sec.value })) }, 'Speichern')),
      h('div', { class: 'panel' }, h('h2', {}, 'Logos'),
        h('p', { class: 'hint' }, 'Logo 1 erscheint links, Logo 2 rechts im Kopf der Anzeige. PNG, JPG, SVG oder WebP, max. 8 MB.'),
        h('div', { class: 'row' }, logoBox(1, s.logo1), logoBox(2, s.logo2))));
  }

  // ---- Räume ----
  function roomDialog(r) {
    const f = { name: h('input', { value: r?.name || '', required: true }), slug: h('input', { value: r?.slug || '', placeholder: 'wird aus dem Namen erzeugt' }),
      main: h('input', { type: 'checkbox', checked: !!r?.is_main }), sort: h('input', { type: 'number', value: r?.sort ?? '' }) };
    dialog(r ? 'Raum bearbeiten' : 'Raum anlegen', [
      h('label', {}, 'Name', f.name),
      h('label', {}, 'Kurzname für die URL (Slug)', f.slug),
      h('label', {}, f.main, 'Hauptbühne (nur ein Raum kann Hauptbühne sein)'),
      h('label', {}, 'Reihenfolge', f.sort)],
    () => api(r ? 'PUT' : 'POST', '/api/admin/rooms' + (r ? '/' + r.id : ''), { name: f.name.value, slug: f.slug.value, is_main: f.main.checked, sort: f.sort.value }));
  }
  function renderRooms() {
    const root = $('tab-rooms'); root.replaceChildren(
      h('div', { class: 'panel' }, h('h2', {}, 'Räume'),
        h('p', { class: 'hint' }, 'Programmpunkte mit „Nur Hauptbühne“ erscheinen auf der Hauptbühne und in allen anderen Räumen mit Hinweis.'),
        h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'URL'), h('th', {}, '')),
          data.rooms.map((r) => h('tr', {},
            h('td', {}, r.name, ' ', r.is_main && h('span', { class: 'tag main' }, 'Hauptbühne')),
            h('td', {}, h('code', {}, '/raum/' + r.slug)),
            h('td', {}, h('div', { class: 'actions' },
              h('button', { class: 'ghost', onclick: () => roomDialog(r) }, 'Bearbeiten'),
              h('button', { class: 'danger', onclick: () => {
                if (confirm(`Raum „${r.name}“ löschen? Zugeordnete Programmpunkte verlieren diese Zuordnung.`)) act(() => api('DELETE', '/api/admin/rooms/' + r.id), 'Raum gelöscht')();
              } }, 'Löschen')))))),
        h('p', {}, h('button', { class: 'primary', onclick: () => roomDialog() }, '+ Raum anlegen'))));
  }

  // ---- Programm ----
  function itemDialog(it) {
    const s = data.settings;
    const f = {
      date: h('input', { type: 'date', value: it?.date || s.event_date, required: true }),
      start: h('input', { type: 'time', value: it?.start || '', required: true }), end: h('input', { type: 'time', value: it?.end || '', required: true }),
      title: h('input', { value: it?.title || '', required: true }),
      speaker: h('input', { value: it?.speaker || '' }), company: h('input', { value: it?.company || '' }),
      description: h('textarea', { rows: 3 }, it?.description || ''),
      type: h('select', {}, h('option', { value: 'talk', selected: (it?.type || 'talk') === 'talk' }, 'Programmpunkt / Vortrag'),
        h('option', { value: 'break', selected: it?.type === 'break' }, 'Pause / Rahmenprogramm (dezent dargestellt)')),
      scope: h('select', {}, ...[['rooms', 'Nur in ausgewählten Räumen'], ['main', 'Nur Hauptbühne (in anderen Räumen als Hinweis)'], ['all', 'Alle Räume']]
        .map(([v, l]) => h('option', { value: v, selected: (it?.scope || 'rooms') === v }, l))),
    };
    const checks = data.rooms.map((r) => ({ r, cb: h('input', { type: 'checkbox', checked: it?.room_ids?.includes(r.id) }) }));
    const roomBox = h('div', {}, h('label', {}, 'Räume'), ...checks.map(({ r, cb }) => h('label', {}, cb, r.name, r.is_main ? ' (Hauptbühne)' : '')));
    const sync = () => (roomBox.hidden = f.scope.value !== 'rooms');
    f.scope.addEventListener('change', sync); sync();
    dialog(it ? 'Programmpunkt bearbeiten' : 'Programmpunkt anlegen', [
      h('div', { class: 'row' }, h('label', {}, 'Datum', f.date), h('label', {}, 'Beginn', f.start), h('label', {}, 'Ende', f.end)),
      h('label', {}, 'Titel', f.title),
      h('div', { class: 'row' }, h('label', {}, 'Referent/in', f.speaker), h('label', {}, 'Firma', f.company)),
      h('label', {}, 'Beschreibung (optional)', f.description),
      h('div', { class: 'row' }, h('label', {}, 'Art', f.type), h('label', {}, 'Zuordnung', f.scope)),
      roomBox],
    () => api(it ? 'PUT' : 'POST', '/api/admin/items' + (it ? '/' + it.id : ''), {
      date: f.date.value, start: f.start.value, end: f.end.value, title: f.title.value, speaker: f.speaker.value, company: f.company.value,
      description: f.description.value, type: f.type.value, scope: f.scope.value, room_ids: checks.filter((c) => c.cb.checked).map((c) => c.r.id) }));
  }
  function renderItems() {
    const root = $('tab-items'), rn = (id) => data.rooms.find((r) => r.id === id)?.name;
    const rows = []; let lastDate = null;
    for (const it of data.items) {
      if (it.date !== lastDate) { rows.push(h('tr', { class: 'dayhead' }, h('td', { colspan: 4 }, fmtDate(it.date)))); lastDate = it.date; }
      const where = it.scope === 'all' ? h('span', { class: 'tag' }, 'Alle Räume')
        : it.scope === 'main' ? h('span', { class: 'tag main' }, 'Nur Hauptbühne')
        : it.room_ids.map((id) => h('span', { class: 'tag' }, rn(id) || '?'));
      rows.push(h('tr', {},
        h('td', {}, `${it.start}–${it.end}`),
        h('td', {}, h('strong', {}, it.title), it.type === 'break' && h('span', { class: 'tag brk' }, 'Pause'),
          (it.speaker || it.company) && h('div', { class: 'hint' }, [it.speaker, it.company].filter(Boolean).join(' · '))),
        h('td', {}, where),
        h('td', {}, h('div', { class: 'actions' },
          h('button', { class: 'ghost', onclick: () => itemDialog(it) }, 'Bearbeiten'),
          h('button', { class: 'ghost', title: 'Duplizieren', onclick: () => itemDialog({ ...it, id: undefined }) }, 'Kopie'),
          h('button', { class: 'danger', onclick: () => { if (confirm(`„${it.title}“ löschen?`)) act(() => api('DELETE', '/api/admin/items/' + it.id), 'Gelöscht')(); } }, 'Löschen')))));
    }
    root.replaceChildren(h('div', { class: 'panel' }, h('h2', {}, 'Programm'),
      h('p', {}, h('button', { class: 'primary', onclick: () => itemDialog() }, '+ Programmpunkt anlegen')),
      data.items.length ? h('table', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Programmpunkt'), h('th', {}, 'Räume'), h('th', {}, '')), rows)
        : h('p', { class: 'hint' }, 'Noch keine Programmpunkte.')));
  }

  // ---- Partner ----
  function partnerDialog(p) {
    const file = h('input', { type: 'file', accept: 'image/*' });
    const f = { name: h('input', { value: p?.name || '', required: true }), category: h('input', { value: p?.category || '' }), sort: h('input', { type: 'number', value: p?.sort ?? '' }) };
    dialog(p ? 'Partner bearbeiten' : 'Partner anlegen', [
      h('label', {}, 'Firmenname', f.name),
      h('label', {}, 'Rolle / Kategorie (optional)', f.category),
      p && h('label', {}, 'Reihenfolge', f.sort),
      h('label', {}, 'Logo' + (p ? ' (leer lassen = unverändert)' : ''), file)],
    () => {
      const fd = new FormData(); fd.append('name', f.name.value); fd.append('category', f.category.value);
      if (p) fd.append('sort', f.sort.value);
      if (file.files[0]) fd.append('file', file.files[0]);
      return api(p ? 'PUT' : 'POST', '/api/admin/partners' + (p ? '/' + p.id : ''), fd);
    });
  }
  function renderPartners() {
    $('tab-partners').replaceChildren(h('div', { class: 'panel' }, h('h2', {}, data.settings.partners_title || 'Partner'),
      h('p', { class: 'hint' }, data.settings.partners_enabled === '1' ? 'Die Partner-Seite ist aktiv.' : 'Die Partner-Seite ist deaktiviert (Reiter „Veranstaltung“).'),
      h('p', {}, h('button', { class: 'primary', onclick: () => partnerDialog() }, '+ Partner anlegen')),
      h('table', {}, h('tr', {}, h('th', {}, 'Logo'), h('th', {}, 'Firma'), h('th', {}, '')),
        data.partners.map((p) => h('tr', {},
          h('td', {}, p.logo ? h('img', { class: 'thumb', src: logoUrl(p.logo), alt: '' }) : '–'),
          h('td', {}, h('strong', {}, p.name), p.category && h('div', { class: 'hint' }, p.category)),
          h('td', {}, h('div', { class: 'actions' },
            h('button', { class: 'ghost', onclick: () => partnerDialog(p) }, 'Bearbeiten'),
            h('button', { class: 'danger', onclick: () => { if (confirm(`„${p.name}“ löschen?`)) act(() => api('DELETE', '/api/admin/partners/' + p.id), 'Gelöscht')(); } }, 'Löschen'))))))));
  }

  // ---- Links ----
  function renderLinks() {
    const base = location.origin, row = (label, path) => h('div', { class: 'linkrow' }, h('strong', { style: 'min-width:9rem' }, label), h('code', {}, base + path),
      h('button', { class: 'ghost', onclick: () => navigator.clipboard.writeText(base + path).then(() => toast('Link kopiert')) }, 'Kopieren'),
      h('a', { href: path, target: '_blank', rel: 'noopener' }, h('button', { class: 'ghost' }, 'Öffnen')));
    $('tab-links').replaceChildren(h('div', { class: 'panel' }, h('h2', {}, 'Anzeige-Links'),
      h('p', { class: 'hint' }, 'Diese Adressen im Vollbild (F11) auf dem jeweiligen Bildschirm öffnen.'),
      data.rooms.map((r) => row(r.name + (r.is_main ? ' (Hauptbühne)' : ''), '/raum/' + r.slug)),
      row('Nur Partner-Seite', '/partner'),
      h('h3', { style: 'margin-top:1.2rem' }, 'Optionen & Test'),
      h('p', { class: 'hint' }, 'Zeitreise zum Testen: ', h('code', {}, '?now=2026-10-08T14:30'), ' · Ohne Partner-Wechsel: ', h('code', {}, '?rotate=0'))));
  }

  start();
})();
