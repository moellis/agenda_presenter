import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TZ = 'Europe/Berlin';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = 'admin';
  console.warn('WARNUNG: ADMIN_PASSWORD nicht gesetzt, Standard-Passwort "admin" aktiv!');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('sess:' + ADMIN_PASSWORD).digest('hex');

// ---------- Datenbank ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'agenda.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  is_main INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
  title TEXT NOT NULL, speaker TEXT DEFAULT '', company TEXT DEFAULT '', description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'talk', scope TEXT NOT NULL DEFAULT 'rooms');
CREATE TABLE IF NOT EXISTS item_rooms (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, room_id));
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT DEFAULT '',
  logo TEXT DEFAULT '', sort INTEGER NOT NULL DEFAULT 0);
`);

const DEFAULTS = {
  title: 'Veranstaltung', subtitle: '', event_date: '', logo1: '', logo2: '',
  accent: '#005498', partners_enabled: '1', partners_title: 'Die Partner der Veranstaltung',
  rotate_agenda_sec: '45', rotate_partner_sec: '15',
};
const getSettings = () => {
  const s = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) s[r.key] = r.value;
  return s;
};
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));

const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

// ---------- Erstbefüllung ----------
function seed() {
  const had = db.prepare('SELECT COUNT(*) c FROM rooms').get().c > 0 || db.prepare('SELECT COUNT(*) c FROM items').get().c > 0 || db.prepare("SELECT 1 FROM settings WHERE key='seeded'").get();
  if (had) { setSetting('seeded', '1'); return; }
  setSetting('seeded', '1');
  const seedDir = path.join(__dirname, 'seed-assets');
  const copy = (f) => { if (fs.existsSync(path.join(seedDir, f))) fs.copyFileSync(path.join(seedDir, f), path.join(UPLOAD_DIR, f)); return f; };
  const D = '2026-10-08';
  setSetting('title', 'IT-Sicherheitsforum Allgäu 2026');
  setSetting('subtitle', '8. Oktober 2026 · Hotel Das Flax, Dietmannsried');
  setSetting('event_date', D);
  setSetting('logo1', copy('its-logo.png'));
  setSetting('logo2', copy('nexperto-logo.jpg'));
  const room = db.prepare('INSERT INTO rooms(name,slug,is_main,sort) VALUES(?,?,?,?)');
  const main = Number(room.run('Hauptbühne', 'hauptbuehne', 1, 0).lastInsertRowid);
  const see = Number(room.run('Raum See', 'see', 0, 1).lastInsertRowid);
  const ins = db.prepare('INSERT INTO items(date,start,end,title,speaker,company,description,type,scope) VALUES(?,?,?,?,?,?,?,?,?)');
  const link = db.prepare('INSERT INTO item_rooms(item_id,room_id) VALUES(?,?)');
  const add = (s, e, title, speaker, company, desc, type, scope, rooms = []) => {
    const id = Number(ins.run(D, s, e, title, speaker, company, desc, type, scope).lastInsertRowid);
    rooms.forEach((r) => link.run(id, r));
  };
  add('12:00', '13:00', 'Registrierung, Mittagssnack & Partnerausstellung', '', '', 'Ankommen, erste Gespräche, Networking beim Rundgang durch die Ausstellung.', 'break', 'all');
  add('13:00', '13:45', 'Podiumsdiskussion: „Was passiert wirklich bei einem Sicherheitsvorfall?“', 'Cyber-Versicherung, Forensiker und betroffenes Unternehmen', '', 'Die ersten Stunden nach einem Angriff, häufige Fehler und die Zusammenarbeit mit Versicherung & Forensik.', 'talk', 'main');
  add('13:45', '13:55', 'Pitch-Duell: Track A vs. Track B', 'Referenten beider Tracks', '', 'Die Referenten stellen ihre Themen im Kurzpitch vor – danach entscheiden Sie, welchen Vortrag Sie besuchen.', 'talk', 'main');
  add('13:55', '14:20', 'Networking & Kaffeepause', '', '', '', 'break', 'all');
  add('14:20', '14:50', 'Mehr als Firewall & Antivirus – moderne Netzwerksicherheit', 'Stefan Dewenter', 'WatchGuard', '', 'talk', 'rooms', [main]);
  add('14:20', '14:50', 'Mitarbeiter als stärkste Verteidigung – Awareness & E-Mail-Sicherheit', 'Stefanie Kaiser', 'Hornetsecurity', '', 'talk', 'rooms', [see]);
  add('14:55', '15:25', 'Datenschutz trifft KI – lokale KI-Modelle für mehr Sicherheit', 'Dennis Heinrich', 'Microsoft', '', 'talk', 'rooms', [main]);
  add('14:55', '15:25', '„Big Brother oder Big Helper?“ – Wenn KI auf Kameras trifft', 'Franziska Berger', 'Axis Kamerasysteme', '', 'talk', 'rooms', [see]);
  add('15:25', '15:55', 'Networking-Pause', '', '', '', 'break', 'all');
  add('15:55', '16:25', 'Nach dem Angriff ist vor dem Angriff – was echte Cyber-Schadenfälle Unternehmen lehren', 'Volker Tosch', 'Allianz', '', 'talk', 'rooms', [main]);
  add('15:55', '16:25', 'Informationssicherheit im KMU: Der pragmatische Weg zu nachhaltiger Sicherheit', 'David Raschdorf', 'NEXPERTO', '', 'talk', 'rooms', [see]);
  add('16:30', '17:00', 'Ask the Experts – Ihre Fragen an unsere Experten', 'Moderierte Fragerunde', '', 'Fragen können während der gesamten Veranstaltung per QR-Code und Smartphone eingereicht werden.', 'talk', 'main');
  add('17:00', '17:15', 'Kaffeepause', '', '', '', 'break', 'all');
  add('17:15', '18:00', 'Abschluss-Keynote: Live-Hacking', 'Tobias Schrödel', '', 'Wie Angreifer heute wirklich vorgehen – und was Unternehmen daraus lernen können.', 'talk', 'main');
  add('18:00', '20:00', 'Get-together, Abendessen & Networking', '', '', 'Partnerausstellung und Gespräche mit den Speakern.', 'break', 'all');

  const pIns = db.prepare('INSERT INTO partners(name,category,logo,sort) VALUES(?,?,?,?)');
  [
    ['WatchGuard', 'Technologie-Partner · Netzwerksicherheit', 'partner-watchguard.png'],
    ['Hornetsecurity', 'Technologie-Partner · E-Mail-Sicherheit', 'partner-hornetsecurity.png'],
    ['Microsoft', 'Technologie-Partner · KI & Datenschutz', 'partner-microsoft.png'],
    ['Allianz', 'Partner · Cyber-Versicherung', 'partner-allianz.png'],
    ['ITQ – Institut für Technologiequalität', 'Technologie-Partner · NIS2 & ISO 27001', 'partner-itq.png'],
    ['Yubico', 'Technologie-Partner · Authentifizierung', 'partner-yubico.png'],
    ['Axis Kamerasysteme', 'Technologie-Partner · Sicherheitstechnik', 'partner-axis.png'],
    ['Autohaus Widmann + Winterholler', 'Ausstellungspartner & Sponsor', 'partner-widmann.jpg'],
  ].forEach(([n, c, f], i) => pIns.run(n, c, copy(f), i));
  console.log('Datenbank mit Beispieldaten (IT-Sicherheitsforum Allgäu 2026) befüllt.');
}
seed();

// ---------- Zeit ----------
function berlinNow(override) {
  if (override && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(override)) {
    return override.length === 16 ? override + ':00' : override;
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

// ---------- Auswertung je Raum ----------
function buildState(slug, nowOverride) {
  const settings = getSettings();
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort, id').all();
  const room = rooms.find((r) => r.slug === slug) || null;
  const main = rooms.find((r) => r.is_main) || null;
  const now = berlinNow(nowOverride);

  const links = db.prepare('SELECT item_id, room_id FROM item_rooms').all();
  const rows = db.prepare('SELECT * FROM items ORDER BY date, start, end, id').all();
  const items = [];
  for (const it of rows) {
    const rids = links.filter((l) => l.item_id === it.id).map((l) => l.room_id);
    let visible = false, elsewhere = null;
    if (!room) visible = true;
    else if (it.scope === 'all') visible = true;
    else if (it.scope === 'main') {
      visible = true;
      if (main && room.id !== main.id) elsewhere = main.name;
    } else if (rids.includes(room.id)) visible = true;
    if (!visible) continue;
    const startTs = `${it.date}T${it.start}:00`, endTs = `${it.date}T${it.end}:00`;
    let status = now >= endTs ? 'past' : now >= startTs ? 'current' : 'upcoming';
    const rm = it.scope === 'main' ? (main ? [main] : []) : it.scope === 'rooms' ? rooms.filter((r) => rids.includes(r.id)) : [];
    items.push({ roomNames: rm.map((r) => r.name), roomSlugs: rm.map((r) => r.slug), id: it.id, date: it.date, start: it.start, end: it.end, title: it.title, speaker: it.speaker, company: it.company,
      description: it.description, type: it.type, scope: it.scope, elsewhere, status, startTs, endTs });
  }
  // aktuell: bevorzugt echtes Programm vor Pause
  const cur = items.filter((i) => i.status === 'current');
  const current = cur.find((i) => i.type !== 'break') || cur[0] || null;
  const upcoming = items.filter((i) => i.status === 'upcoming');
  const next = upcoming.find((i) => i.type !== 'break' && i.id !== current?.id) || null;
  if (current) current.status = 'current';
  for (const i of items) if (i.status === 'current' && i !== current) i.status = 'current-secondary';
  const phase = !items.length ? 'empty' : current ? 'live' : upcoming.length ? (items.some((i) => i.status === 'past') ? 'between' : 'before') : 'after';

  const partners = db.prepare('SELECT id,name,category,logo FROM partners ORDER BY sort, id').all();
  return {
    now, phase, settings: {
      title: settings.title, subtitle: settings.subtitle, event_date: settings.event_date, logo1: settings.logo1, logo2: settings.logo2,
      accent: settings.accent, partners_enabled: settings.partners_enabled === '1', partners_title: settings.partners_title,
      rotate_agenda_sec: Number(settings.rotate_agenda_sec) || 45, rotate_partner_sec: Number(settings.rotate_partner_sec) || 15,
    },
    room: room && { id: room.id, name: room.name, slug: room.slug, is_main: !!room.is_main },
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, slug: r.slug, is_main: !!r.is_main })),
    items, currentId: current?.id ?? null, nextId: next?.id ?? null, partners,
  };
}

// ---------- Auth ----------
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function isAuthed(req) {
  const c = parseCookies(req).session;
  if (!c) return false;
  const [exp, sig] = c.split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}
const requireAuth = (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'Nicht angemeldet' }));
const attempts = new Map();

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
// Hinter einem Reverse-Proxy (Traefik, Nginx Proxy Manager, Caddy …): echte Client-IP für die Login-Sperre
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);

// ---------- Export / Import (Sicherung) ----------
const SETTING_KEYS = ['title', 'subtitle', 'event_date', 'logo1', 'logo2', 'accent', 'partners_enabled', 'partners_title', 'rotate_agenda_sec', 'rotate_partner_sec'];
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|gif|webp|svg)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function buildExport() {
  const all = getSettings(), settings = {};
  for (const k of SETTING_KEYS) settings[k] = all[k];
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort, id').all();
  const links = db.prepare('SELECT item_id, room_id FROM item_rooms').all();
  const slugOf = (id) => rooms.find((r) => r.id === id)?.slug;
  const items = db.prepare('SELECT * FROM items ORDER BY date, start, end, id').all().map((i) => ({
    date: i.date, start: i.start, end: i.end, title: i.title, speaker: i.speaker, company: i.company, description: i.description,
    type: i.type, scope: i.scope, rooms: links.filter((l) => l.item_id === i.id).map((l) => slugOf(l.room_id)).filter(Boolean) }));
  const partners = db.prepare('SELECT * FROM partners ORDER BY sort, id').all().map((p) => ({ name: p.name, category: p.category, logo: p.logo, sort: p.sort }));
  const names = new Set([settings.logo1, settings.logo2, ...partners.map((p) => p.logo)].filter(Boolean));
  const files = {};
  for (const n of names) {
    if (!FILE_NAME.test(n)) continue;
    try { files[n] = { type: MIME[n.split('.').pop().toLowerCase()], data: fs.readFileSync(path.join(UPLOAD_DIR, n)).toString('base64') }; } catch {}
  }
  return { format: 'agenda-presenter-export', version: 1, exportedAt: new Date().toISOString(), settings,
    rooms: rooms.map((r) => ({ name: r.name, slug: r.slug, is_main: !!r.is_main, sort: r.sort })), items, partners, files };
}

function validateImport(d) {
  const bad = (m) => { throw new Error('Import-Datei ungültig: ' + m); };
  if (!d || d.format !== 'agenda-presenter-export' || d.version !== 1) bad('keine Export-Datei dieser Anwendung');
  if (!d.settings || typeof d.settings !== 'object') bad('Einstellungen fehlen');
  for (const k of ['rooms', 'items', 'partners']) if (!Array.isArray(d[k])) bad(k + ' fehlt');
  if (d.rooms.length > 50 || d.items.length > 2000 || d.partners.length > 200) bad('zu viele Einträge');
  const slugs = new Set();
  for (const r of d.rooms) {
    if (typeof r.name !== 'string' || !r.name.trim() || typeof r.slug !== 'string' || !/^[a-z0-9-]{1,60}$/.test(r.slug)) bad('Raum fehlerhaft');
    if (slugs.has(r.slug)) bad('Raumkürzel doppelt: ' + r.slug); slugs.add(r.slug);
  }
  if (d.rooms.filter((r) => r.is_main).length > 1) bad('mehr als eine Hauptbühne');
  for (const i of d.items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date) || !TIME.test(i.start) || !TIME.test(i.end) || i.end <= i.start) bad('Zeit fehlerhaft bei „' + i.title + '“');
    if (typeof i.title !== 'string' || !i.title.trim()) bad('Programmpunkt ohne Titel');
    if (!['all', 'main', 'rooms'].includes(i.scope) || !['talk', 'break'].includes(i.type)) bad('Art/Zuordnung fehlerhaft bei „' + i.title + '“');
    for (const s of i.rooms || []) if (!slugs.has(s)) bad('unbekannter Raum „' + s + '“');
  }
  for (const p of d.partners) if (typeof p.name !== 'string' || !p.name.trim()) bad('Partner ohne Namen');
  const files = d.files && typeof d.files === 'object' ? d.files : {};
  const referenced = [d.settings.logo1, d.settings.logo2, ...d.partners.map((p) => p.logo)].filter(Boolean);
  for (const n of referenced) if (!FILE_NAME.test(n) || !files[n]) bad('Logo-Datei fehlt: ' + n);
  const decoded = {};
  for (const [n, f] of Object.entries(files)) {
    if (!FILE_NAME.test(n) || typeof f.data !== 'string') bad('Dateiname ungültig: ' + n);
    const buf = Buffer.from(f.data, 'base64');
    if (buf.length > 8 * 1024 * 1024) bad('Datei zu groß: ' + n);
    if (!headLooksLikeImage(buf)) bad('kein gültiges Bild: ' + n);
    decoded[n] = buf;
  }
  return decoded;
}

function applyImport(d) {
  const decoded = validateImport(d);
  // automatische Sicherung des aktuellen Stands
  const bdir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, 'vor-import-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify(buildExport()));
  for (const old of fs.readdirSync(bdir).sort().slice(0, -5)) fs.rmSync(path.join(bdir, old), { force: true });
  for (const [n, buf] of Object.entries(decoded)) fs.writeFileSync(path.join(UPLOAD_DIR, n), buf);
  tx(() => {
    db.exec('DELETE FROM item_rooms; DELETE FROM items; DELETE FROM rooms; DELETE FROM partners;');
    const slugToId = {};
    d.rooms.forEach((r, i) => { slugToId[r.slug] = Number(db.prepare('INSERT INTO rooms(name,slug,is_main,sort) VALUES(?,?,?,?)').run(r.name.trim(), r.slug, r.is_main ? 1 : 0, Number.isFinite(r.sort) ? r.sort : i).lastInsertRowid); });
    for (const i of d.items) {
      const id = Number(db.prepare('INSERT INTO items(date,start,end,title,speaker,company,description,type,scope) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(i.date, i.start, i.end, i.title.trim(), String(i.speaker || ''), String(i.company || ''), String(i.description || ''), i.type, i.scope).lastInsertRowid);
      if (i.scope === 'rooms') for (const s of i.rooms || []) db.prepare('INSERT OR IGNORE INTO item_rooms(item_id,room_id) VALUES(?,?)').run(id, slugToId[s]);
    }
    d.partners.forEach((p, i) => db.prepare('INSERT INTO partners(name,category,logo,sort) VALUES(?,?,?,?)').run(p.name.trim(), String(p.category || ''), p.logo || '', Number.isFinite(p.sort) ? p.sort : i));
    for (const k of SETTING_KEYS) if (k in d.settings) {
      let v = d.settings[k];
      if (k === 'accent' && !/^#[0-9a-fA-F]{6}$/.test(v)) continue;
      if (k.startsWith('rotate_')) v = Math.max(5, Math.min(600, parseInt(v) || 15));
      setSetting(k, v);
    }
    setSetting('seeded', '1');
  });
  // nicht mehr verwendete Dateien aufräumen
  const used = new Set([getSettings().logo1, getSettings().logo2, ...db.prepare('SELECT logo FROM partners').all().map((p) => p.logo)].filter(Boolean));
  for (const f of fs.readdirSync(UPLOAD_DIR)) if (!used.has(f)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
}

app.get('/api/admin/export', requireAuth, (req, res) => {
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(/[: ]/g, (c) => (c === ' ' ? '-' : '')).slice(0, 15);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="agenda-export-${stamp}.json"`, 'Cache-Control': 'no-store' });
  res.send(JSON.stringify(buildExport()));
});
app.post('/api/admin/import', requireAuth, express.json({ limit: '80mb' }), (req, res) => {
  try { applyImport(req.body); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.use(express.json({ limit: '1mb' }));

app.get('/sw.js', (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('js').sendFile(path.join(__dirname, 'public', 'sw.js')); });
app.use('/uploads', (req, res, next) => { res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'"); res.set('X-Content-Type-Options', 'nosniff'); next(); },
  express.static(UPLOAD_DIR, { maxAge: '1h' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { const ok = /^image\/(png|jpe?g|svg\+xml|webp|gif)$/.test(file.mimetype); if (!ok) req.badFile = true; cb(null, ok); },
});
// Dateiinhalt prüfen (nicht nur die vom Browser gemeldete Art)
function headLooksLikeImage(h) {
  const hex = h.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e47')) return true;                       // PNG
  if (hex.startsWith('ffd8ff')) return true;                         // JPEG
  if (hex.startsWith('47494638')) return true;                       // GIF
  if (hex.startsWith('52494646') && h.subarray(8, 12).toString() === 'WEBP') return true;
  return /<svg[\s>]/i.test(h.subarray(0, 256).toString('utf8'));     // SVG
}
function looksLikeImage(file) {
  try {
    const fd = fs.openSync(file.path, 'r'); const b = Buffer.alloc(256); const n = fs.readSync(fd, b, 0, 256, 0); fs.closeSync(fd);
    return headLooksLikeImage(b.subarray(0, n));
  } catch { return false; }
}
function checkUpload(req) {
  if (req.badFile) throw new Error('Nur Bilddateien (PNG, JPG, SVG, WebP, GIF) sind erlaubt');
  if (req.file && !looksLikeImage(req.file)) { removeUpload(req.file.filename); req.file = undefined; throw new Error('Die Datei ist kein gültiges Bild'); }
}
const removeUpload = (name) => { if (name && !name.includes('/') && !name.includes('..')) fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {}); };
const isSeedShared = (name) => db.prepare('SELECT 1 FROM partners WHERE logo=?').get(name) || ['logo1', 'logo2'].some((k) => getSettings()[k] === name);

// Öffentlich
app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(buildState(String(req.query.room || ''), req.query.now && String(req.query.now)));
});

// Login
app.post('/api/login', (req, res) => {
  const ip = req.ip, a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Zu viele Versuche, bitte später erneut versuchen.' });
  if (!safeEq(String(req.body.password || ''), ADMIN_PASSWORD)) { a.n++; attempts.set(ip, a); return res.status(403).json({ error: 'Falsches Passwort' }); }
  const exp = String(Date.now() + 12 * 3600 * 1000);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.set('Set-Cookie', `session=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.set('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: isAuthed(req) }));

// Admin-API
const admin = express.Router();
admin.use(requireAuth);

admin.get('/all', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort, id').all().map((r) => ({ ...r, is_main: !!r.is_main }));
  const links = db.prepare('SELECT item_id, room_id FROM item_rooms').all();
  const items = db.prepare('SELECT * FROM items ORDER BY date, start, end, id').all().map((i) => ({ ...i, room_ids: links.filter((l) => l.item_id === i.id).map((l) => l.room_id) }));
  res.json({ settings: getSettings(), rooms, items, partners: db.prepare('SELECT * FROM partners ORDER BY sort, id').all() });
});

admin.get('/qr', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\/[^\s]{1,300}$/.test(url)) return res.status(400).json({ error: 'Ungültige Adresse' });
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

admin.put('/settings', (req, res) => {
  const allowed = ['title', 'subtitle', 'event_date', 'accent', 'partners_enabled', 'partners_title', 'rotate_agenda_sec', 'rotate_partner_sec'];
  for (const k of allowed) if (k in req.body) {
    let v = req.body[k];
    if (k === 'accent' && !/^#[0-9a-fA-F]{6}$/.test(v)) continue;
    if (k.startsWith('rotate_')) v = Math.max(5, Math.min(600, parseInt(v) || 15));
    setSetting(k, v);
  }
  res.json({ ok: true });
});
admin.post('/logo/:slot', upload.single('file'), (req, res) => {
  const key = req.params.slot === '1' ? 'logo1' : req.params.slot === '2' ? 'logo2' : null;
  try { checkUpload(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!key || !req.file) return res.status(400).json({ error: 'Keine gültige Bilddatei' });
  const old = getSettings()[key];
  setSetting(key, req.file.filename);
  if (old && !isSeedShared(old)) removeUpload(old);
  res.json({ ok: true, file: req.file.filename });
});
admin.delete('/logo/:slot', (req, res) => {
  const key = req.params.slot === '1' ? 'logo1' : 'logo2';
  const old = getSettings()[key]; setSetting(key, '');
  if (old && !isSeedShared(old)) removeUpload(old);
  res.json({ ok: true });
});

const slugify = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'raum';
function saveRoom(id, b) {
  const name = String(b.name || '').trim();
  if (!name) throw new Error('Name fehlt');
  const slug = slugify(b.slug || name);
  tx(() => {
    if (b.is_main) db.prepare('UPDATE rooms SET is_main=0').run();
    if (id) db.prepare('UPDATE rooms SET name=?, slug=?, is_main=?, sort=? WHERE id=?').run(name, slug, b.is_main ? 1 : 0, Number(b.sort) || 0, id);
    else db.prepare('INSERT INTO rooms(name,slug,is_main,sort) VALUES(?,?,?,?)').run(name, slug, b.is_main ? 1 : 0, Number(b.sort) || (db.prepare('SELECT COALESCE(MAX(sort),-1)+1 n FROM rooms').get().n));
  });
}
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Kurzname (Slug) ist bereits vergeben' : e.message }); } };
admin.post('/rooms', wrap((req, res) => { saveRoom(null, req.body); res.json({ ok: true }); }));
admin.put('/rooms/:id', wrap((req, res) => { saveRoom(Number(req.params.id), req.body); res.json({ ok: true }); }));
admin.delete('/rooms/:id', wrap((req, res) => { db.prepare('DELETE FROM rooms WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); }));

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function saveItem(id, b) {
  const v = { date: String(b.date || '').trim(), start: String(b.start || '').trim(), end: String(b.end || '').trim(), title: String(b.title || '').trim() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error('Datum ungültig');
  if (!TIME.test(v.start) || !TIME.test(v.end)) throw new Error('Uhrzeit ungültig (HH:MM)');
  if (v.end <= v.start) throw new Error('Ende muss nach dem Beginn liegen');
  if (!v.title) throw new Error('Titel fehlt');
  const type = b.type === 'break' ? 'break' : 'talk';
  const scope = ['all', 'main', 'rooms'].includes(b.scope) ? b.scope : 'rooms';
  const rids = scope === 'rooms' ? (b.room_ids || []).map(Number) : [];
  tx(() => {
    if (id) {
      db.prepare('UPDATE items SET date=?,start=?,end=?,title=?,speaker=?,company=?,description=?,type=?,scope=? WHERE id=?')
        .run(v.date, v.start, v.end, v.title, b.speaker || '', b.company || '', b.description || '', type, scope, id);
      db.prepare('DELETE FROM item_rooms WHERE item_id=?').run(id);
    } else {
      id = Number(db.prepare('INSERT INTO items(date,start,end,title,speaker,company,description,type,scope) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(v.date, v.start, v.end, v.title, b.speaker || '', b.company || '', b.description || '', type, scope).lastInsertRowid);
    }
    for (const r of rids) db.prepare('INSERT OR IGNORE INTO item_rooms(item_id,room_id) VALUES(?,?)').run(id, r);
  });
}
admin.post('/items', wrap((req, res) => { saveItem(null, req.body); res.json({ ok: true }); }));
admin.put('/items/:id', wrap((req, res) => { saveItem(Number(req.params.id), req.body); res.json({ ok: true }); }));
admin.delete('/items/:id', wrap((req, res) => { db.prepare('DELETE FROM items WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); }));

admin.post('/partners', upload.single('file'), wrap((req, res) => {
  checkUpload(req);
  const name = String(req.body.name || '').trim();
  if (!name) { if (req.file) removeUpload(req.file.filename); throw new Error('Firmenname fehlt'); }
  const sort = db.prepare('SELECT COALESCE(MAX(sort),-1)+1 n FROM partners').get().n;
  db.prepare('INSERT INTO partners(name,category,logo,sort) VALUES(?,?,?,?)').run(name, req.body.category || '', req.file?.filename || '', sort);
  res.json({ ok: true });
}));
admin.put('/partners/:id', upload.single('file'), wrap((req, res) => {
  checkUpload(req);
  const id = Number(req.params.id), p = db.prepare('SELECT * FROM partners WHERE id=?').get(id);
  if (!p) throw new Error('Nicht gefunden');
  const name = String(req.body.name ?? p.name).trim();
  if (!name) throw new Error('Firmenname fehlt');
  db.prepare('UPDATE partners SET name=?, category=?, logo=?, sort=? WHERE id=?')
    .run(name, req.body.category ?? p.category, req.file?.filename || p.logo, req.body.sort !== undefined ? Number(req.body.sort) : p.sort, id);
  if (req.file && p.logo) removeUpload(p.logo);
  res.json({ ok: true });
}));
admin.delete('/partners/:id', wrap((req, res) => {
  const p = db.prepare('SELECT * FROM partners WHERE id=?').get(Number(req.params.id));
  if (p) { db.prepare('DELETE FROM partners WHERE id=?').run(p.id); removeUpload(p.logo); }
  res.json({ ok: true });
}));
app.use('/api/admin', admin);

// Seiten
app.get('/raum/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/partner', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/agenda', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Serverfehler' }); });
app.listen(PORT, () => console.log(`Agenda-Presenter läuft auf http://localhost:${PORT}`));

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
