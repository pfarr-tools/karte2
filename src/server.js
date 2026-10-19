import Fastify from 'fastify';
import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';
import { syncSourceDefinitions, sourceDefinitions } from './db/source-registry.js';

function publicPage() {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pfarrstellenkarte</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
</head>
<body>
  <main class="container-fluid py-3">
    <header class="mb-3">
      <h1>Pfarrstellenkarte</h1>
      <p class="text-body-secondary">Pfarrstellen der Evangelischen Landeskirche in Württemberg</p>
      <p class="alert alert-warning"><strong>Hinweis:</strong> Diese Übersicht ist unoffiziell. Maßgeblich sind die originalen ELKW-Dokumente.</p>
    </header>
    <section class="row g-3" aria-label="Pfarrstellenübersicht">
      <div class="col-12 col-lg-7 order-lg-2"><div id="map" style="height: 70vh" aria-label="Karte der Pfarrstellen"></div></div>
      <div class="col-12 col-lg-5 order-lg-1">
        <form id="filters" class="row g-2 mb-3">
          <div class="col-12"><label class="form-label" for="search">Suche</label><input id="search" name="q" class="form-control" type="search" placeholder="Name, Ort oder Beschreibung"></div>
          <div class="col-12"><label class="form-label" for="category">Kategorie</label><select id="category" name="category" class="form-select"><option value="">Alle</option><option value="advertised">Aktuelle Ausschreibungen</option><option value="available">Verfügbare Pfarrstellen</option><option value="upcoming">Liste zu besetzender Pfarrstellen</option></select></div>
        </form>
        <div id="results" aria-live="polite">Lade Pfarrstellen …</div>
      </div>
    </section>
  </main>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([48.6, 9.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);
    const markers = L.layerGroup().addTo(map);
    const results = document.querySelector('#results');
    const form = document.querySelector('#filters');
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    function render(items) {
      markers.clearLayers();
      results.innerHTML = items.length ? items.map((item) => '<article class="card mb-2"><div class="card-body"><h2 class="h5">' + escapeHtml(item.name) + '</h2><p class="mb-1">' + escapeHtml(item.type || '') + (item.deanery ? ' · ' + escapeHtml(item.deanery) : '') + '</p><p class="mb-1">Kategorie: ' + escapeHtml(item.category) + '</p><p class="small text-body-secondary">Quelle: ' + escapeHtml(item.source.name) + '</p><a href="' + escapeHtml(item.documentUrl) + '">Originaldokument</a></div></article>').join('') : '<p>Keine Pfarrstellen gefunden.</p>';
      items.flatMap((item) => item.locations).filter((location) => location.latitude !== null && location.longitude !== null).forEach((location) => L.marker([location.latitude, location.longitude]).bindPopup(escapeHtml(location.name)).addTo(markers));
    }
    async function load() { const params = new URLSearchParams(new FormData(form)); const response = await fetch('/api/publications?' + params); render((await response.json()).items); }
    form.addEventListener('input', load); load();
  </script>
</body>
</html>`;
}

function publicationItems(database, query) {
  const clauses = [];
  const values = [];
  if (query.category) { clauses.push('pub.category = ?'); values.push(query.category); }
  if (query.q) {
    clauses.push(`(p.normalized_name LIKE ? OR p.description LIKE ? OR p.deanery LIKE ? OR l.name LIKE ? OR l.address LIKE ?)`);
    const search = `%${query.q}%`;
    values.push(search, search, search, search, search);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database.prepare(`
    SELECT pub.id, p.normalized_name AS name, p.type, p.deanery, p.employment_percentage,
      pub.category, pub.application_deadline, pub.current_state,
      l.name AS location_name, l.address, l.latitude, l.longitude, pl.role,
      s.name AS source_name, s.url AS source_url, d.original_url AS document_url
    FROM publications pub
    JOIN positions p ON p.id = pub.position_id
    JOIN sources s ON s.id = pub.source_id
    LEFT JOIN documents d ON d.id = pub.document_id
    LEFT JOIN position_locations pl ON pl.position_id = p.id
    LEFT JOIN locations l ON l.id = pl.location_id
    ${where}
    ORDER BY p.normalized_name, pub.category, pub.id
  `).all(...values);
  const items = new Map();
  for (const row of rows) {
    if (!items.has(row.id)) items.set(row.id, {
      id: row.id, name: row.name, category: row.category, type: row.type, deanery: row.deanery,
      employmentPercentage: row.employment_percentage, deadline: row.application_deadline,
      state: row.current_state, locations: [], source: { name: row.source_name, url: row.source_url },
      documentUrl: row.document_url,
    });
    if (row.location_name) items.get(row.id).locations.push({
      name: row.location_name, address: row.address, latitude: row.latitude, longitude: row.longitude, role: row.role,
    });
  }
  return [...items.values()];
}

function csvCell(value) {
  const text = value ?? '';
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function publicationsCsv(items) {
  const header = ['Name', 'Kategorie', 'Dekanat', 'Ort', 'Quelle', 'Originaldokument'];
  const rows = items.map((item) => [
    item.name,
    item.category,
    item.deanery,
    item.locations.map((location) => location.name).join(', '),
    item.source.name,
    item.documentUrl,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n') + '\n';
}

export function buildServer({ database = null } = {}) {
  const server = Fastify({ logger: true });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/', async (_, reply) => reply.type('text/html').send(publicPage()));
  server.get('/api/publications', async (request) => ({ items: database ? publicationItems(database, request.query) : [] }));
  server.get('/api/publications.csv', async (request, reply) => reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename="pfarrstellen.csv"')
    .send(publicationsCsv(database ? publicationItems(database, request.query) : [])));
  return server;
}

export function bootstrapDatabase(database = openDatabase(config)) {
  migrateDatabase(database);
  syncSourceDefinitions(database, sourceDefinitions);
  return database;
}

export async function startServer({ database } = {}) {
  bootstrapDatabase(database);
  const server = buildServer({ database: bootstrapDatabase(database) });
  await server.listen({ host: '0.0.0.0', port: config.port });
  return server;
}

if (process.argv[1]?.endsWith('/src/server.js')) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
