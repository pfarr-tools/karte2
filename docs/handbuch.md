# karte2 – Benutzer- und Administrationshandbuch

Version 1.0 · 19. Oktober 2026

## 1. Zweck und wichtige Hinweise

karte2 sammelt offizielle Veröffentlichungen zu Pfarrstellen der Evangelischen
Landeskirche in Württemberg (ELKW), liest die verlinkten PDF-Dokumente und stellt
die Ergebnisse als Karte und Liste bereit.

Die Anwendung ist eine **unoffizielle Übersicht**. Verbindlich sind immer die
originalen ELKW-Veröffentlichungen. Eine Position in der Kategorie „Liste zu
besetzender Pfarrstellen“ ist keine Aufforderung zur Bewerbung. Auch bei einer
unbekannten oder abgelaufenen Frist darf karte2 nicht als Aussage über die
aktuelle Bewerbungsfähigkeit verstanden werden.

Die alte zusätzliche `a&b`-Quelle gehört nicht zum System. Quelle ist ausschließlich
die aktuelle ELKW-Seite und die dort verlinkten offiziellen PDFs.

## 2. Für Besucherinnen und Besucher

### 2.1 Startseite

Nach dem Aufruf der Webadresse zeigt die Startseite:

- eine Leaflet-Karte für Baden-Württemberg,
- eine zugängliche Ergebnisliste neben der Karte,
- Filter für Freitext und Veröffentlichungskategorie,
- Marker für bekannte Standorte,
- die Quellenbezeichnung und den Link zum originalen PDF.

Die Liste ist auch ohne Kartennutzung verwendbar. Auf kleinen Bildschirmen ordnen
sich Karte und Liste untereinander an.

### 2.2 Suche und Filter

Das Suchfeld durchsucht Positionsname, Beschreibung, Dekanat, Ort und Adresse.
Der Kategorienfilter unterscheidet:

| Anzeige | Bedeutung |
| --- | --- |
| Aktuelle Ausschreibungen | Formale Ausschreibung, gegebenenfalls mit Bewerbungsrunde und Frist |
| Verfügbare Pfarrstellen | Interesse kann nach der Quelle registriert werden |
| Liste zu besetzender Pfarrstellen | Vorabinformation; nicht automatisch bewerbungsoffen |

Die Filter wirken auf Liste, API und CSV-Export gleichermaßen. Die Browser-URL
enthält den Filterzustand nicht als serverseitig gespeicherte Sitzung; für eine
Weitergabe kann deshalb die URL des konkreten Browsers verwendet werden, sofern
der Browser die Query-Parameter beibehält.

### 2.3 Positionsdetails

Ein Klick auf eine Position führt zu `/position/<ID>`. Dort stehen Name, Typ,
Dekanat, Standorte, Kategorien, Quellen und die originalen Dokumente. Historische
Veröffentlichungen bleiben erhalten und werden nicht stillschweigend durch neue
Importe ersetzt.

### 2.4 CSV-Export

Der aktuelle Filter kann als CSV exportiert werden:

```text
/api/publications.csv?category=advertised&q=Stuttgart
```

Das Format verwendet Semikolon als Trennzeichen und enthält Name, Kategorie,
Dekanat, Ort, Quelle und Originaldokument.

## 3. Installation und Betrieb

### 3.1 Voraussetzungen

Auf dem Host werden nur Docker und Docker Compose benötigt. Node.js, Poppler,
SQLite und native npm-Buildwerkzeuge laufen im Container.

```bash
./karte help
./karte build
./karte up
```

`./karte up` baut vor dem Start das aktuelle Image. Dadurch wird verhindert, dass
ein altes Image einen veralteten Quellstand ausführt.

### 3.2 Operator-Befehle

| Befehl | Zweck |
| --- | --- |
| `./karte up` | Anwendung bauen und starten |
| `./karte down` | Anwendung stoppen |
| `./karte restart` | Anwendung neu starten und neu bauen |
| `./karte build` | Image bauen |
| `./karte install` | Image und Abhängigkeiten bauen |
| `./karte logs` | Anwendungslogs verfolgen |
| `./karte shell` | Shell in einem temporären App-Container öffnen |
| `./karte migrate` | Migrationen ausführen und Quellen synchronisieren |
| `./karte status` | Basisstatus von Quellen und Importen ausgeben |
| `./karte import` | ELKW-Seite laden, PDFs speichern, extrahieren und importieren |
| `./karte import --dry-run` | Seite laden und analysieren, ohne SQLite zu ändern |
| `./karte geocode` | Offene Standorte über den konfigurierten Dienst geocodieren |
| `./karte geocode --dry-run` | Geocoding prüfen, ohne Standorte zu ändern |
| `./karte scheduler` | Optionalen täglichen Import-Scheduler starten |
| `./karte backup create` | SQLite und Dokumentarchiv sichern |
| `./karte backup restore <Pfad> --yes` | Backup ausdrücklich wiederherstellen |
| `./karte test` | Isolierte Tests ausführen |

Der Import ist idempotent: dasselbe PDF mit derselben SHA-256-Prüfsumme wird nicht
doppelt angelegt. Ein geändertes PDF erhält eine neue Dokumentversion. Fehler bei
einzelnen PDFs werden als Issue gespeichert; erfolgreiche Dokumente und alte
Versionen bleiben erhalten.

### 3.3 Persistente Daten

Der Compose-Dienst verwendet das Volume `karte-data`:

- `/data/karte.sqlite` – SQLite-Datenbank,
- `/data/documents/` – gespeicherte PDF- und Extraktionsartefakte,
- `/data/backups/` – sofern `BACKUP_ROOT` auf diesen Pfad zeigt.

Die Datenbank darf nicht manuell gelöscht oder durch einen Testlauf ersetzt
werden. Es gibt keinen impliziten Reset-Befehl.

## 4. Konfiguration

Die Vorlage liegt in `.env.example`. Eine lokale `.env` wird nicht committed.

| Variable | Standard | Beschreibung |
| --- | --- | --- |
| `NODE_ENV` | `production` | Laufzeitumgebung; Tests setzen explizit `test` |
| `PORT` | `3000` | Öffentlicher Container-/Hostport |
| `DATABASE_PATH` | `/data/karte.sqlite` | SQLite-Datei im App-Container |
| `RUNTIME_ROOT` | `/data` | Wurzel für PDFs und Artefakte |
| `TEST_ROOT` | `/tmp/karte2-test` | Erlaubtes Testdatenverzeichnis |
| `GEOCODER_URL` | Nominatim-Beispiel | Nominatim-kompatibler Geocoder |
| `BACKUP_ROOT` | `/data/backups` | Ziel für Backups |
| `ADMIN_TOKEN` | leer | Bearer-Token für Admin-Endpunkte |
| `IMPORT_INTERVAL_SECONDS` | `86400` | Scheduler-Intervall |

Für den öffentlichen Nominatim-Dienst gelten dessen Nutzungsbedingungen und
Rate-Limits. Ein eigener oder ausdrücklich erlaubter kompatibler Dienst ist für
regelmäßige Produktion vorzuziehen.

## 5. Administration

### 5.1 Zugang

Admin-Endpunkte werden ausschließlich aktiviert, wenn `ADMIN_TOKEN` gesetzt ist.
Jede Anfrage benötigt:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Ohne Token antwortet die Anwendung mit `503`, bei falschem Token mit `401`.
Das Token gehört in die Laufzeitumgebung oder in eine sichere Reverse-Proxy-
Konfiguration, niemals in Git.

### 5.2 Status und Issues

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/status

curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/issues
```

Der Status enthält Positions-, Dokument- und offene Issue-Zahlen sowie den letzten
Importlauf. Issues enthalten insbesondere ungültige URLs, Downloadfehler,
Extraktionsfehler und verdächtig leere Quellenläufe.

### 5.3 Manueller Import

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/import
```

Der Import verwendet denselben sicheren Pfad wie `./karte import`; parallele
Läufe werden durch den SQLite-Job-Lock verhindert.

### 5.4 PDF erneut verarbeiten

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/documents/42/reprocess
```

Das Original-PDF und seine Prüfsumme bleiben unverändert. Nur Textartefakt,
Extraktionsstatus und Metadaten werden aktualisiert. Bei einem Fehler bleibt das
Dokument mit Status `failed` erhalten.

### 5.5 Standort manuell setzen

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"latitude":48.51,"longitude":9.11}' \
  http://localhost:3000/admin/locations/7
```

Breitengrade außerhalb `-90..90` und Längengrade außerhalb `-180..180` werden
abgelehnt. Manuelle Koordinaten werden als `manual` und `verified` markiert.

### 5.6 Redaktionelle Overrides

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"field":"deanery","value":"Redaktionelles Dekanat","editor":"admin","reason":"Quelle geprüft"}' \
  http://localhost:3000/admin/positions/7/overrides
```

Erlaubte Felder sind `type`, `deanery`, `employment_percentage`,
`employment_description` und `description`. Editor und Begründung sind Pflicht.
Overrides stehen getrennt von Importwerten in `position_overrides`, werden bei
Folgeimporten nicht überschrieben und erzeugen einen Eintrag in
`position_history`.

## 6. Geocoding und Unsicherheit

Geocoding erfolgt nur für Standorte ohne vollständige Koordinaten und wird in
`geocode_cache` gespeichert. Ein eindeutiger Treffer wird als `approximate`
markiert. Mehrere Treffer oder kein Treffer erhalten keine Koordinaten und werden
als `ambiguous` beziehungsweise `not-found` gespeichert. Solche Orte dürfen
nicht stillschweigend auf einen zufälligen Marker gesetzt werden.

Die manuelle Standortkorrektur im Admin-Bereich ist der vorgesehene Weg für
geprüfte regionale, mehrere oder repräsentative Standorte.

## 7. Backups und Wiederherstellung

### 7.1 Backup erstellen

```bash
./karte backup create
```

Ein Backup-Verzeichnis enthält:

- `karte.sqlite` als SQLite-Snapshot,
- `documents/` mit den gespeicherten PDF-Dateien,
- `manifest.json` mit Erstellungszeitpunkt und Inhalt.

Backups sollten regelmäßig auf ein vom Compose-Volume unabhängiges Ziel kopiert
und testweise validiert werden.

### 7.2 Restore

Vor einer Wiederherstellung:

1. Anwendung stoppen: `./karte down`.
2. Backup-Pfad und Manifest prüfen.
3. Restore mit dem exakten Pfad und `--yes` ausführen.
4. Anwendung starten und Status prüfen.

```bash
./karte backup restore /data/backups/2026-10-19T120000Z --yes
./karte up
```

Ohne `--yes` wird keine Datei verändert. Der Restore ersetzt die SQLite-Datei
und das Dokumentarchiv; er ist daher eine ausdrücklich bestätigungspflichtige
Operation.

## 8. Tests und Sicherheit

```bash
./karte test
```

Der Testdienst besitzt kein Produktionsvolume und keine Produktionsgeheimnisse.
Jeder Testlauf läuft in einem eigenen temporären SQLite-Bereich. Netzwerk,
Geocoding und Live-ELKW-Zugriffe werden in den Tests durch Fakes/Fixtures ersetzt.
Ungültige Testpfade, Symlinks auf Laufzeitdaten und nicht gesetztes `NODE_ENV=test`
werden fail-closed abgelehnt.

Die Anwendung:

- akzeptiert PDF-Downloads nur von der konfigurierten offiziellen Quelle,
- begrenzt PDF-Größe und MIME-Typ,
- speichert Original-URL, Abrufzeit und SHA-256,
- escaped importierte Werte vor HTML-Ausgabe,
- verwendet parametrisierte SQLite-Abfragen,
- löscht bei fehlgeschlagenen oder leeren Imports keine Bestandsdaten.

## 9. Fehlerbehebung

### `Cannot find module '/app/src/cli.js'`

Das Image war veraltet. Die aktuellen Wrapper-Befehle bauen automatisch:

```bash
./karte build
./karte import --dry-run
```

### `npm ci` scheitert beim nativen Modulbau

Der Dockerfile installiert `python3`, `make` und `g++` vor `npm ci`. Image neu
bauen und nicht in einem Produktionscontainer mit Host-Node-Abhängigkeiten
arbeiten:

```bash
./karte build
```

### Geocoder liefert keine Marker

`GEOCODER_URL` prüfen, den Cache-/Issue-Status ansehen und Mehrdeutigkeiten
manuell prüfen. Kein Treffer ist ein zulässiger Zustand und kein Grund für eine
automatische Ortsvermutung.

### Import meldet `source-result-empty`

Nicht automatisch bereinigen oder Daten löschen. Die offizielle Seite, die
Netzwerkverbindung und die Parserannahmen prüfen. Bestehende Dokumente bleiben
absichtlich erhalten.

### Docker-Daemon nicht erreichbar

Docker-Socket, Benutzerrechte und den laufenden Docker-Dienst prüfen. Ein
lokaler Node-Aufruf außerhalb des Containers ist kein gleichwertiger Ersatz für
`./karte`.

## 10. Änderungs- und Dokumentationspflicht

Bei jeder Änderung an CLI, HTTP-Endpunkten, Datenmodell, Importlogik,
Konfiguration, Scheduler, Backup oder Benutzeroberfläche müssen dieses Handbuch
und gegebenenfalls `docs/operations.md` im selben Commit aktualisiert werden.
