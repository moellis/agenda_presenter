# Betrieb auf einem Server mit Portainer

Ziel: `https://agenda.it-sicherheitsforum.events`

## 1. Voraussetzungen
- **DNS:** A-/AAAA-Eintrag `agenda.it-sicherheitsforum.events` → Server-IP.
- **HTTPS:** Über euren vorhandenen Reverse-Proxy (Traefik, Nginx Proxy Manager, Caddy …) mit Let's-Encrypt-Zertifikat. HTTPS ist wichtig, weil nur dann der Notfallbetrieb nach einem Neustart ohne Netz funktioniert und der Admin-Login sicher ist.
- Port 3000 (oder `HOST_PORT`) darf **nicht** direkt aus dem Internet erreichbar sein, nur der Proxy greift darauf zu.

## 2. Stack in Portainer anlegen
1. *Stacks → Add stack → Repository*
2. Repository-URL: `https://github.com/moellis/agenda_presenter` · Reference: `refs/heads/main` · Compose path: `docker-compose.yml`
3. Ist das Repository privat: *Authentication* aktivieren, GitHub-Benutzer `moellis` und ein **Personal Access Token** (nur Leserecht auf dieses Repository) eintragen.
4. *Environment variables*:

   | Name | Wert |
   |---|---|
   | `ADMIN_PASSWORD` | **langes, eigenes Passwort** (Pflicht) |
   | `SESSION_SECRET` | langer Zufallswert (optional, empfohlen) |
   | `TRUST_PROXY` | `1` (Standard) |
   | `HOST_PORT` | z. B. `3000`, falls der Proxy auf den Host-Port zeigt |
5. *Deploy the stack*. Portainer baut das Image selbst (ca. 1–2 Minuten). Der Container meldet sich nach ~30 s als „healthy“.

## 3. Reverse-Proxy
Weiterleiten von `agenda.it-sicherheitsforum.events` an den Container, Port **3000**, Protokoll http.
- **Nginx Proxy Manager:** Proxy Host → Domain · Scheme `http` · Forward Host = Server-IP (oder Containername im gemeinsamen Netz) · Port `3000` · *SSL*: neues Let's-Encrypt-Zertifikat, „Force SSL“ an. WebSockets sind nicht nötig.
- **Traefik:** Container ins Proxy-Netzwerk hängen und Labels setzen, z. B.
  `traefik.enable=true`, `traefik.http.routers.agenda.rule=Host(\`agenda.it-sicherheitsforum.events\`)`, `traefik.http.routers.agenda.tls.certresolver=<euer Resolver>`, `traefik.http.services.agenda.loadbalancer.server.port=3000`
- **Caddy:** `agenda.it-sicherheitsforum.events { reverse_proxy agenda-presenter:3000 }`

## 4. Erster Start
- Beim ersten Start wird das IT-Sicherheitsforum Allgäu 2026 (Agenda, Logos, Partner) automatisch angelegt.
- Admin: `https://agenda.it-sicherheitsforum.events/admin` – Passwort aus `ADMIN_PASSWORD`.
- **Wichtig:** Den Admin über die öffentliche Adresse öffnen, bevor ihr den QR-Code erzeugt (Admin → „Anzeige-Links“ → „QR-Code“).

## 5. Adressen
- Hauptbühne: `/raum/hauptbuehne` · Raum See: `/raum/see`
- Partner-Seite: `/partner` · Handy-Agenda: `/agenda`

## 6. Abnahme-Checkliste (vor dem 8.10.)
- [ ] `https://…/` lädt, Schloss im Browser, Zertifikat gültig
- [ ] Admin-Login klappt, Passwort ist **nicht** `admin`
- [ ] Beide Raum-Adressen auf den echten Bildschirmen im Vollbild geprüft (Quer-/Hochformat)
- [ ] Zeitreise-Test: `…/raum/hauptbuehne?now=2026-10-08T14:30`
- [ ] QR-Code mit einem Handy gescannt, `/agenda` lädt
- [ ] Netz am Display kurz getrennt: Symbol erscheint, Agenda läuft weiter
- [ ] Datensicherung angelegt (siehe unten)

## 7. Sicherung
Alle Daten (Datenbank, hochgeladene Logos) liegen im Volume `agenda-data` (Pfad im Container `/data`).
Sicherung z. B. mit:
`docker run --rm -v agenda-data:/data -v $PWD:/backup alpine tar czf /backup/agenda-backup.tgz -C /data .`
Vor Änderungen am Veranstaltungstag eine Sicherung ziehen.

## 8. Aktualisieren
Neue Version im Repository → in Portainer beim Stack *Pull and redeploy* (Re-pull image / Rebuild aktiv). Die Daten im Volume bleiben erhalten. Browser der Anzeigegeräte danach einmal mit F5 neu laden.

## 9. Fehlersuche
- *Login gesperrt (429)*: nach 10 Fehlversuchen 15 Minuten Pause pro IP. Container neu starten hebt die Sperre auf.
- *Bild- oder Uhrzeit-Probleme*: Die Uhrzeit kommt vom Server (Europe/Berlin, unabhängig von der Zeitzone des Hosts).
- *Logs*: Portainer → Container `agenda-presenter` → Logs.
