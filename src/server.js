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
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css">
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
          <div class="col-12 col-md-6"><label class="form-label" for="type">Stellentyp</label><input id="type" name="type" class="form-control" type="text" placeholder="z. B. Pfarrstelle"></div>
          <div class="col-12 col-md-6"><label class="form-label" for="deanery">Dekanat</label><input id="deanery" name="deanery" class="form-control" type="text"></div>
          <div class="col-6"><label class="form-label" for="employmentMin">Beschäftigung ab (%)</label><input id="employmentMin" name="employmentMin" class="form-control" type="number" min="0" max="100"></div>
          <div class="col-6"><label class="form-label" for="deadlineAfter">Frist ab</label><input id="deadlineAfter" name="deadlineAfter" class="form-control" type="date"></div>
        </form>
        <div id="results" aria-live="polite">Lade Pfarrstellen …</div>
      </div>
    </section>
  </main>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script>
    const map = L.map('map').setView([48.6, 9.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);
    const markers = L.markerClusterGroup({ showCoverageOnHover: false }).addTo(map);
    const results = document.querySelector('#results');
    const form = document.querySelector('#filters');
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const categoryColors = { advertised: '#b02a37', available: '#146c43', upcoming: '#664d03' };
    const markerFor = (location, category) => L.marker([location.latitude, location.longitude], {
      icon: L.divIcon({ className: 'karte-marker', html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:' + (categoryColors[category] || '#0d6efd') + ';border:2px solid white;box-shadow:0 0 0 1px #333"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
    });
    function render(items) {
      markers.clearLayers();
      results.innerHTML = items.length ? items.map((item) => '<article class="card mb-2"><div class="card-body"><h2 class="h5">' + escapeHtml(item.name) + '</h2><p class="mb-1">' + escapeHtml(item.type || '') + (item.deanery ? ' · ' + escapeHtml(item.deanery) : '') + '</p><p class="mb-1">Kategorie: ' + escapeHtml(item.category) + '</p><p class="small text-body-secondary">Quelle: ' + escapeHtml(item.source.name) + '</p><a href="' + escapeHtml(item.documentUrl) + '">Originaldokument</a></div></article>').join('') : '<p>Keine Pfarrstellen gefunden.</p>';
      items.flatMap((item) => item.locations.map((location) => ({ ...location, category: item.category, name: item.name }))).filter((location) => location.latitude !== null && location.longitude !== null).forEach((location) => markerFor(location, location.category).bindPopup(escapeHtml(location.name)).addTo(markers));
    }
    function currentParams() { return new URLSearchParams([...new FormData(form)].filter(([, value]) => value !== '')); }
    function stateParams() { const params = currentParams(); const center = map.getCenter(); params.set('mapLat', center.lat.toFixed(5)); params.set('mapLng', center.lng.toFixed(5)); params.set('mapZoom', String(map.getZoom())); return params; }
    function replaceUrl() { const params = stateParams(); history.replaceState(null, '', '?' + params); }
    function restoreParams() { const params = new URLSearchParams(window.location.search); for (const control of form.elements) if (control.name && params.has(control.name)) control.value = params.get(control.name); const lat = Number(params.get('mapLat')); const lng = Number(params.get('mapLng')); const zoom = Number(params.get('mapZoom')); if ([lat, lng, zoom].every(Number.isFinite) && zoom >= 0 && zoom <= 20 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) map.setView([lat, lng], zoom); }
    async function load() { const params = stateParams(); replaceUrl(); const response = await fetch('/api/publications?' + new URLSearchParams([...params].filter(([key]) => !key.startsWith('map')))); render((await response.json()).items); }
    restoreParams(); map.on('moveend', replaceUrl); form.addEventListener('input', load); load();
  </script>
</body>
</html>`;
}

function publicationItems(database, query) {
  const clauses = [];
  const values = [];
  if (query.category) { clauses.push('pub.category = ?'); values.push(query.category); }
  if (query.positionId) { clauses.push('p.id = ?'); values.push(Number(query.positionId)); }
  if (query.q) {
    clauses.push(`(p.normalized_name LIKE ? OR p.description LIKE ? OR p.deanery LIKE ? OR l.name LIKE ? OR l.address LIKE ?)`);
    const search = `%${query.q}%`;
    values.push(search, search, search, search, search);
  }
  if (query.type) { clauses.push('p.type = ?'); values.push(query.type); }
  if (query.deanery) { clauses.push('p.deanery = ?'); values.push(query.deanery); }
  if (query.employmentMin !== undefined && query.employmentMin !== '') { clauses.push('p.employment_percentage >= ?'); values.push(Number(query.employmentMin)); }
  if (query.employmentMax !== undefined && query.employmentMax !== '') { clauses.push('p.employment_percentage <= ?'); values.push(Number(query.employmentMax)); }
  if (query.deadlineAfter) { clauses.push('pub.application_deadline >= ?'); values.push(query.deadlineAfter); }
  if (query.deadlineBefore) { clauses.push('pub.application_deadline <= ?'); values.push(query.deadlineBefore); }
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function positionDetailPage(item) {
  const publications = item.publications.map((publication) => `<li>${escapeHtml(publication.category)} – <a href="${escapeHtml(publication.documentUrl)}">Originaldokument</a> (Quelle: ${escapeHtml(publication.source.name)})</li>`).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(item.position.name)} – Pfarrstellenkarte</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"></head><body><main class="container py-4"><a href="/">← Zur Übersicht</a><h1 class="mt-3">${escapeHtml(item.position.name)}</h1><p>${escapeHtml(item.position.type)}${item.position.deanery ? ` · ${escapeHtml(item.position.deanery)}` : ''}</p><h2 class="h4">Standorte</h2><ul>${item.position.locations.map((location) => `<li>${escapeHtml(location.name)}${location.address ? `, ${escapeHtml(location.address)}` : ''}</li>`).join('')}</ul><h2 class="h4">Veröffentlichungen und Quellen</h2><ul>${publications}</ul><p class="alert alert-warning">Unverbindliche Übersicht. Maßgeblich sind die originalen ELKW-Dokumente.</p></main></body></html>`;
}

export function buildServer({ database = null, adminToken = config.adminToken, importRunner = null } = {}) {
  const server = Fastify({ logger: true });
  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin/')) return;
    if (!adminToken) return reply.code(503).send({ error: 'Admin access is not configured' });
    const authorization = request.headers.authorization ?? '';
    if (authorization !== `Bearer ${adminToken}`) return reply.code(401).send({ error: 'Unauthorized' });
  });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/', async (_, reply) => reply.type('text/html').send(publicPage()));
  server.get('/api/publications', async (request) => ({ items: database ? publicationItems(database, request.query) : [] }));
  server.get('/api/positions/:id', async (request, reply) => {
    const items = database ? publicationItems(database, { positionId: request.params.id }) : [];
    if (!items.length) return reply.code(404).send({ error: 'Position not found' });
    return {
      position: { id: Number(request.params.id), name: items[0].name, type: items[0].type, deanery: items[0].deanery, locations: items[0].locations },
      publications: items,
    };
  });
  server.get('/position/:id', async (request, reply) => {
    const items = database ? publicationItems(database, { positionId: request.params.id }) : [];
    if (!items.length) return reply.code(404).send({ error: 'Position not found' });
    return reply.type('text/html').send(positionDetailPage({
      position: { name: items[0].name, type: items[0].type, deanery: items[0].deanery, locations: items[0].locations },
      publications: items,
    }));
  });
  server.get('/api/publications.csv', async (request, reply) => reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename="pfarrstellen.csv"')
    .send(publicationsCsv(database ? publicationItems(database, request.query) : [])));
  server.get('/admin/status', async () => {
    if (!database) return { positions: 0, documents: 0, unresolvedIssues: 0, lastImport: null };
    return {
      positions: database.prepare('SELECT COUNT(*) AS count FROM positions').get().count,
      documents: database.prepare('SELECT COUNT(*) AS count FROM documents').get().count,
      unresolvedIssues: database.prepare('SELECT COUNT(*) AS count FROM import_issues WHERE resolved_at IS NULL').get().count,
      lastImport: database.prepare('SELECT id, status, completed_at, counts_json FROM import_runs ORDER BY id DESC LIMIT 1').get() ?? null,
    };
  });
  server.get('/admin/issues', async () => ({ issues: database
    ? database.prepare('SELECT id, import_run_id, document_id, severity, code, message, context_json FROM import_issues WHERE resolved_at IS NULL ORDER BY id DESC').all()
    : [] }));
  server.post('/admin/import', async (_, reply) => {
    const runner = importRunner ?? (async () => {
      const { runCli } = await import('./cli.js');
      return runCli(['import'], { database });
    });
    return reply.send(await runner());
  });
  server.post('/admin/documents/:id/reprocess', async (request, reply) => {
    const { reprocessDocument } = await import('./import/document-reprocessor.js');
    const { extractPdfText } = await import('./import/pdf-extractor.js');
    return reply.send(await reprocessDocument({
      database,
      documentId: Number(request.params.id),
      extractDocumentImpl: extractPdfText,
    }));
  });
  server.post('/admin/locations/:id', async (request, reply) => {
    const latitude = Number(request.body?.latitude);
    const longitude = Number(request.body?.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return reply.code(400).send({ error: 'Invalid coordinates' });
    }
    const result = database?.prepare(`
      UPDATE locations SET latitude = ?, longitude = ?, geocoding_provider = 'manual', geocoding_confidence = 'verified', verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(latitude, longitude, Number(request.params.id));
    if (!result?.changes) return reply.code(404).send({ error: 'Location not found' });
    return { status: 'updated', locationId: Number(request.params.id) };
  });
  server.post('/admin/positions/:id/overrides', async (request, reply) => {
    const allowedFields = new Set(['type', 'deanery', 'employment_percentage', 'employment_description', 'description']);
    const { field, value, editor, reason } = request.body ?? {};
    if (!allowedFields.has(field) || value === undefined || !String(editor ?? '').trim() || !String(reason ?? '').trim()) {
      return reply.code(400).send({ error: 'field, value, editor and reason are required' });
    }
    const positionId = Number(request.params.id);
    const position = database?.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    if (!position) return reply.code(404).send({ error: 'Position not found' });
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`INSERT INTO position_overrides (position_id, field_name, override_value, editor, reason, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(position_id, field_name) DO UPDATE SET override_value = excluded.override_value, editor = excluded.editor, reason = excluded.reason, updated_at = excluded.updated_at`).run(positionId, field, String(value), String(editor), String(reason));
      database.prepare(`UPDATE positions SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(value, positionId);
      database.prepare('INSERT INTO position_history (position_id, event_type, before_json, after_json, occurred_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)').run(positionId, 'editorial-override', JSON.stringify({ [field]: position[field] }), JSON.stringify({ [field]: value }));
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { status: 'updated', positionId, field };
  });
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
