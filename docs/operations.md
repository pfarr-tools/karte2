# Betrieb

## Start

`./karte up` startet das vorhandene Image der Webanwendung. Nach Änderungen am
Quellcode oder an Abhängigkeiten zuerst `./karte build` ausführen. Die Datenbank,
PDFs und Backups liegen im Compose-Volume `karte-data`. Für die optionale tägliche
Synchronisierung wird `./karte scheduler` verwendet; der Scheduler verhindert
parallele Läufe mit einem SQLite-Lock.

`./karte status` zeigt den aktuellen Status der Compose-Dienste. Der bisherige
Anwendungsstatus mit Quellen- und Importzahlen ist über `./karte app-status`
verfügbar.

## Import und Geocoding

```bash
./karte import --dry-run
./karte import
./karte import --force
./karte import --file /data/documents/name.pdf
./karte geocode
```

Der Geocoder schreibt während des Laufs Fortschrittszeilen nach `stderr`, zum
Beispiel `[Geocoding] 12/87 Ort: geocodiert`. Das abschließende JSON bleibt auf
`stdout` und kann daher weiterhin von Skripten ausgewertet werden.

`GEOCODER_URL` muss auf einen Nominatim-kompatiblen Dienst zeigen. Mehrdeutige
Treffer erhalten keine Koordinaten und müssen administrativ geprüft werden.
Der Standardwert `GEOCODER_MIN_INTERVAL_MS=1000` begrenzt die Anfragen auf eine
für öffentliche Nominatim-Dienste angemessene Frequenz. HTTP-429- und
vorübergehende 5xx-Fehler werden mit Backoff wiederholt. Das CLI-Ergebnis weist
unter `failureReasons` die konkreten Fehlerursachen aus.

Die optionale Grenzdatei der Kirchenbezirke wird über `KIRCHENBEZIRKE_PATH`
eingebunden. Unterstützt werden das Vorgängerformat von `KiBez.json` (Objekt
aus Bezeichnung und Koordinatenlisten) sowie GeoJSON. Ist die Datei nicht
vorhanden, bleibt die Karte ohne Grenzebene; die Anwendung startet trotzdem.
Der Abruf der offiziellen ELKW-Seite wird bei temporären Netzwerkfehlern oder
HTTP 429/5xx mit begrenztem exponentiellem Backoff wiederholt.

## Administration

`ADMIN_TOKEN` schützt die Admin-Endpunkte per `Authorization: Bearer ...`:

- `GET /health` mit Laufstatus, letztem erfolgreichen Import und offenen Issues

- `GET /admin/status`
- `GET /admin/imports`
- `GET /admin/issues`
- `POST /admin/import`
- `POST /admin/documents/:id/reprocess`
- `POST /admin/locations/:id` mit `latitude` und `longitude`
- `POST /admin/positions/:id/overrides` mit `field`, `value`, `editor` und `reason`

Ohne konfiguriertes Token bleiben Admin-Endpunkte deaktiviert. Redaktionelle
Overrides werden getrennt gespeichert und in `position_history` protokolliert.

## Backups und Restore

```bash
./karte backup create
./karte backup restore /data/backups/2026-10-19T120000Z --yes
```

Restore ist absichtlich bestätigungspflichtig und darf nur bei gestopptem App-
Container ausgeführt werden. Der Backup enthält einen SQLite-Snapshot, das
Dokumentarchiv und ein Manifest.

## Tests

`./karte test` verwendet ausschließlich den isolierten Test-Service und eine
temporäre Testdatenbank. Tests greifen weder auf das Produktionsvolume noch auf
Secrets oder externe Quellen zu.
