# Betrieb

## Start

`./karte up` baut das aktuelle Image und startet die Webanwendung. Die Datenbank,
PDFs und Backups liegen im Compose-Volume `karte-data`. Für die optionale tägliche
Synchronisierung wird `./karte scheduler` verwendet; der Scheduler verhindert
parallele Läufe mit einem SQLite-Lock.

## Import und Geocoding

```bash
./karte import --dry-run
./karte import
./karte geocode
```

`GEOCODER_URL` muss auf einen Nominatim-kompatiblen Dienst zeigen. Mehrdeutige
Treffer erhalten keine Koordinaten und müssen administrativ geprüft werden.

## Administration

`ADMIN_TOKEN` schützt die Admin-Endpunkte per `Authorization: Bearer ...`:

- `GET /admin/status`
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
