# Cron-Synchronisierung und signierte Geocoding-Prüfung

Status: Entwurf zur Prüfung
Datum: 2026-10-20

## Ziel

`karte2` soll ohne interaktive CLI-Prüfung dauerhaft per Cron betrieben werden
können. Ein einzelner Lauf importiert die ELKW-Daten, geocodiert offene
Standorte und informiert bei verbleibenden Mehrdeutigkeiten per E-Mail. Die
E-Mail enthält einen zeitlich begrenzten, signierten Link zu einer deutschen
Prüfseite. Dort können die Treffer wie im Vorgänger ausgewählt, neu gesucht
oder übersprungen werden.

Die bestehende sichere Batch-Regel bleibt erhalten: Mehrdeutige oder nicht
aufgelöste Standorte erhalten keine öffentlichen Marker.

## Verifiziertes Vorgängerverhalten

`../karte/resources/js/Pages/Map.vue` startet Leaflet mit
`setView([46.05, 11.05], 5)` und ruft nach dem Laden der Marker
`fitBounds(jobGroup.getBounds())` auf. Die neue Karte übernimmt dieses Verhalten
für die Initialisierung und verwendet nur dann eine feste Baden-Württemberg-
Ansicht, wenn keine Marker vorhanden sind.

`../karte/app/Console/Commands/CorrectGeocoding.php` bietet bei der manuellen
Geocodierung eine Trefferliste, die Auswahl eines Treffers, eine neue manuelle
Suche und Abbruch. Die Web-Prüfung bildet genau diesen Ablauf ab.

## Bedienablauf

Der neue Operator-Befehl lautet:

```text
./karte sync
```

Ein Lauf führt in dieser Reihenfolge aus:

1. Import der offiziellen ELKW-Seite einschließlich PDF-Download und Parsing.
2. Batch-Geocoding aller offenen Standorte mit Cache und Rate-Limit.
3. Speicherung aller Kandidaten für mehrdeutige Treffer.
4. Erstellung eines Review-Laufs, wenn ungelöste Standorte vorhanden sind.
5. Versand höchstens einer Benachrichtigung je unverändertem offenen Bestand.

Der Befehl gibt ein maschinenlesbares Ergebnis aus und beendet sich bei
erfolgreichem Import auch dann kontrolliert, wenn einzelne Standorte offen
bleiben. Fehlt die für eine erforderliche Benachrichtigung nötige
Mail-Konfiguration, wird dies als Fehler im Ergebnis und Log ausgewiesen.
Import- oder Geocoding-Fehler werden nicht durch den Mailversand verschleiert.

Der bestehende `./karte geocode`-Befehl bleibt für manuelle bzw. diagnostische
Läufe erhalten. `./karte geocode --review` bleibt als lokale interaktive
Alternative verfügbar. Der optionale Compose-Scheduler ruft dieselbe
Synchronisierungsorchestrierung wie `sync` auf, damit Cron und Scheduler nicht
auseinanderlaufen.

## Persistenz

Eine Migration ergänzt drei Tabellen:

### `geocode_review_runs`

- `id`, `created_at`, `expires_at`
- `token_hash` (nur Hash, niemals der Link-Token)
- `unresolved_count`, `fingerprint`
- `sent_at`, `completed_at`

### `geocode_review_candidates`

- `id`, `review_run_id`, `location_id`
- `query`, `candidates_json`, `created_at`
- `resolved_at`, `selected_candidate_json`

Kandidaten werden als vom Geocoder gelieferte JSON-Daten gespeichert, damit die
Prüfseite reproduzierbar bleibt und nicht bei jedem Seitenaufruf erneut den
Geocoder kontaktiert. Die Standorttabelle bleibt die maßgebliche Quelle für
die endgültig bestätigten Koordinaten.

Die Fingerabdruckbildung ist deterministisch und umfasst Standort-ID,
Standortname, aktuelle Suchversion und Kandidaten. Für denselben offenen
Bestand wird keine weitere E-Mail verschickt. Nach einer Auflösung oder einer
Änderung der Kandidaten entsteht ein neuer Fingerabdruck.

## Signierte Links und HTTP-Seite

Der Link hat die Form:

```text
/review/geocoding/{review-id}.{expiry}.{signature}
```

Die Signatur ist HMAC-SHA-256 über Review-ID und Ablaufzeit. Der Secret-Wert
kommt ausschließlich aus `REVIEW_LINK_SECRET`. Die Prüfung verwendet einen
zeitkonstanten Vergleich, prüft Ablaufzeit und den gespeicherten Token-Hash.
Ein abgelaufener, manipulierter oder bereits ungültiger Link liefert keinen
Review-Inhalt.

Die Seite zeigt pro offenem Standort:

- Pfarrstellenname, Ort und Kirchenbezirk,
- alle zugeordneten offiziellen Veröffentlichungen,
- Link zum originalen PDF bzw. zur offiziellen Quelle,
- die verwendete Geocoder-Suche,
- Kandidaten mit `display_name`, Koordinaten und Auswahlaktion,
- eine manuelle neue Suche sowie die Aktion „Überspringen“.

Die Seite und alle Aktionen sind deutsch. Eine Auswahl schreibt die
Koordinaten mit Provider `manual-review`, Konfidenz `verified` und Zeitstempel
in `locations`. Sie markiert den Kandidatensatz als erledigt und schreibt die
Auflösung in die bestehende Positions-/Standorthistorie, soweit diese bereits
vorhanden ist. Überspringen verändert keine Koordinaten.

Die Review-URL ist eine eigenständige, zeitlich begrenzte Berechtigung. Die
zukünftige Einschränkung auf `@elkw.de`/`@elk-wue.de` wird nicht vorgezogen und
ist nicht Bestandteil dieser Änderung.

## E-Mail und Konfiguration

Die Mail wird über einen SMTP-kompatiblen Transport versendet. Die Anwendung
verwendet folgende Konfiguration:

```env
APP_URL=https://karte.example.org
REVIEW_LINK_SECRET=change-me
REVIEW_LINK_TTL_SECONDS=604800
MAIL_HOST=smtp.example.org
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=
MAIL_PASSWORD=
MAIL_FROM=karte@example.org
UNRESOLVED_MAIL_TO=christoph@example.org
```

`APP_URL`, `REVIEW_LINK_SECRET`, `MAIL_FROM` und `UNRESOLVED_MAIL_TO` werden
bei aktivierter Benachrichtigung benötigt. Zugangsdaten stehen nur in `.env`
und niemals in Logs oder Review-Daten. Die E-Mail enthält die Anzahl offener
Standorte, den Ablaufzeitpunkt und den signierten Link, aber keine vollständige
Kandidatendatenbank.

## Kartenstart

Die öffentliche Karte startet mit der Vorgängeransicht. Nach dem Laden
geocodierter Marker wird auf deren Bounds angepasst. Wenn keine Marker
vorhanden sind, wird die Karte auf eine feste Baden-Württemberg-Ausdehnung
gesetzt. Ein expliziter `mapLat`/`mapLng`/`mapZoom`-URL-Zustand hat Vorrang.

## Fehler- und Sicherheitsverhalten

- Import, Geocoding und Mailversand sind getrennt beobachtbar.
- Mailfehler löschen keine Importdaten und machen keine Standortauflösung.
- Unaufgelöste Standorte bleiben ohne Koordinaten und öffentlich unsichtbar.
- Kandidaten werden escaped dargestellt; Original-URLs unterliegen den bereits
  geltenden Provenienz- und Trusted-Domain-Regeln.
- Review-POSTs akzeptieren nur Kandidaten aus dem konkreten Review-Lauf und
  validieren Koordinaten erneut.
- Tokens werden nicht in SQLite im Klartext gespeichert.
- Ein Review-Link kann keine allgemeinen Admin-Endpunkte aufrufen.

## Teststrategie

Die isolierte Testsuite deckt ab:

- deterministische HMAC-Erzeugung, Ablauf und Manipulation,
- Kandidatenpersistenz und Auswahl/Überspringen,
- Filterung auf den konkreten Review-Lauf,
- Mail-Deduplizierung über Fingerabdrücke,
- SMTP-Transport mit Fake-Transport,
- `sync`-Reihenfolge und Fehleraggregation,
- Review-HTML mit deutschen Texten, Originaldokumenten und escaped Inhalten,
- Kartenstart, Marker-Bounds und URL-Zustand.

Es gibt keine Live-SMTP-, Live-ELKW- oder Live-Geocoder-Anforderung in den
normalen Tests. Testdaten und Tokens bleiben vollständig vom Produktionsvolume
getrennt.

## Nicht Bestandteil

- Benutzerkonten oder allgemeine Session-Authentifizierung,
- automatische Annahme mehrdeutiger Treffer,
- automatische Löschung alter Review-Läufe,
- die zukünftige ELKW-Maildomain-Beschränkung,
- ein neuer SPA-Frontend-Stack.
