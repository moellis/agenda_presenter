# Agenda-Presenter

Vollbild-Agenda für Veranstaltungen: mehrere Räume, Hauptbühne, „Jetzt“ / „Als Nächstes“, Partner-Seite, Admin-Oberfläche.

## Start

    ADMIN_PASSWORD=geheim docker compose up -d --build     # oder: npm install && ADMIN_PASSWORD=geheim npm start

- Anzeige je Raum: `/raum/<slug>` (z. B. `/raum/hauptbuehne`, `/raum/see`)
- Partner-Seite allein: `/partner` (in der Raum-Anzeige wechselt sie automatisch, Zeiten im Admin einstellbar)
- Admin: `/admin` (Passwort aus `ADMIN_PASSWORD`)
- Testen: `?now=2026-10-08T14:30` simuliert die Uhrzeit, `?rotate=0` schaltet den Partner-Wechsel aus
- Daten (SQLite + Uploads) liegen in `DATA_DIR` (Docker: Volume `/data`). Beim ersten Start wird das IT-Sicherheitsforum Allgäu 2026 aus `seed-assets/` angelegt.
- Zeitzone: Europe/Berlin, Aktualisierung der Anzeige alle 10 s.
