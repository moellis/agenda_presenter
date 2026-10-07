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

## Notfallbetrieb ohne Verbindung

- Fällt die Verbindung zum Server aus, läuft die Anzeige weiter: „Jetzt“ / „Als Nächstes“ und die Fortschrittsanzeige werden im Browser berechnet. Grundlage ist die zuletzt vom Server gemeldete Zeit, fortgeschrieben mit der Uhr des Geräts. Oben rechts erscheint ein kleines durchgestrichenes WLAN-Symbol.
- Sobald der Server wieder antwortet, hat er Vorrang: Daten und Uhrzeit kommen wieder von dort, das Symbol verschwindet.
- Wird die Seite ohne Verbindung neu geladen, werden die zuletzt gespeicherten Daten verwendet und die Berlin-Zeit der Geräteuhr. Dafür muss die Seite über **https** (oder `localhost`) aufgerufen worden sein, sonst steht der Zwischenspeicher des Browsers (Service Worker) nicht zur Verfügung. Eine bereits geöffnete Anzeige läuft auch über `http` weiter.
- Änderungen im Admin während eines Ausfalls erscheinen erst nach Rückkehr der Verbindung.
