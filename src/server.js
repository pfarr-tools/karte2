import Fastify from 'fastify';
import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';
import { syncSourceDefinitions, sourceDefinitions } from './db/source-registry.js';

const categoryLabels = Object.freeze({
  advertised: 'Aktuelle Ausschreibung',
  available: 'Verfügbare Pfarrstelle',
  upcoming: 'Vormerkliste / künftige Besetzung',
});

function categoryLabel(category) {
  return categoryLabels[category] ?? 'Unbekannte Kategorie';
}

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
  <style>
    :root { --topbar-height: 56px; }
    html, body { height: 100%; margin: 0; }
    body { overflow: hidden; }
    #topbar { min-height: var(--topbar-height); }
    #app-shell, #map-panel, #map { height: calc(100vh - var(--topbar-height)); }
    #map-panel { width: 100%; }
    #list-panel { height: calc(100vh - var(--topbar-height)); overflow: auto; }
    .leaflet-popup-content { margin: 12px 14px; }
  </style>
</head>
<body class="bg-body-tertiary">
  <header id="topbar" class="navbar navbar-dark bg-dark shadow-sm">
    <div class="container-fluid gap-3">
      <a class="navbar-brand fw-semibold" href="/">Pfarrstellenkarte</a>
      <span class="navbar-text d-none d-md-inline">Evangelische Landeskirche in Württemberg</span>
      <div class="ms-auto d-flex align-items-center gap-2">
        <button type="button" class="btn btn-outline-light btn-sm" data-bs-toggle="offcanvas" data-bs-target="#filter-panel" aria-controls="filter-panel">Filter öffnen</button>
        <div class="btn-group btn-group-sm" role="group" aria-label="Ansicht wählen">
          <button type="button" class="btn btn-light active" id="mobile-map" aria-pressed="true">Karte</button>
          <button type="button" class="btn btn-outline-light" id="mobile-list" aria-pressed="false">Liste</button>
        </div>
      </div>
    </div>
  </header>
  <main id="app-shell" aria-label="Pfarrstellenübersicht">
    <section id="map-panel" aria-label="Karte der Pfarrstellen"><div id="map" aria-label="Karte der Pfarrstellen"></div></section>
    <section id="list-panel" class="d-none container-fluid py-3" aria-live="polite" aria-label="Liste der Pfarrstellen">Lade Pfarrstellen …</section>
  </main>
  <div class="offcanvas offcanvas-end" tabindex="-1" id="filter-panel" aria-labelledby="filter-title">
    <div class="offcanvas-header">
      <h2 class="offcanvas-title h5" id="filter-title">Pfarrstellen filtern</h2>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Schließen"></button>
    </div>
    <div class="offcanvas-body">
      <form id="filters" class="row g-3">
        <div class="col-12"><label class="form-label" for="search">Suche</label><input id="search" name="q" class="form-control" type="search" placeholder="Name, Ort oder Beschreibung"></div>
        <div class="col-12"><label class="form-label" for="category">Kategorie</label><select id="category" name="category" class="form-select"><option value="">Alle Kategorien</option><option value="advertised">Aktuelle Ausschreibungen</option><option value="available">Verfügbare Pfarrstellen</option><option value="upcoming">Vormerkliste / künftige Besetzung</option></select></div>
        <div class="col-12"><label class="form-label" for="type">Stellentyp</label><input id="type" name="type" class="form-control" type="text" placeholder="z. B. Pfarrstelle"></div>
        <div class="col-12"><label class="form-label" for="deanery">Dekanat</label><input id="deanery" name="deanery" class="form-control" type="text"></div>
        <div class="col-12"><label class="form-label" for="employmentMin">Beschäftigungsumfang ab (%)</label><input id="employmentMin" name="employmentMin" class="form-control" type="number" min="0" max="100"></div>
        <div class="col-12"><label class="form-label" for="deadlineAfter">Bewerbungsfrist ab</label><input id="deadlineAfter" name="deadlineAfter" class="form-control" type="date"></div>
        <div class="col-12"><label class="form-label" for="sort">Sortieren nach</label><select id="sort" name="sort" class="form-select"><option value="name">Name</option><option value="deadline">Bewerbungsfrist</option></select></div>
        <div class="col-12"><label class="form-label" for="procedure">Bewerbungsverfahren</label><input id="procedure" name="procedure" class="form-control" type="search" placeholder="z. B. Wahl"></div>
      </form>
    </div>
  </div>
  <p class="position-fixed bottom-0 start-0 m-2 small text-bg-warning rounded px-2 py-1 shadow-sm"><strong>Hinweis:</strong> Diese Übersicht ist unoffiziell; maßgeblich sind die originalen ELKW-Dokumente.</p>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    const categoryLabels = { advertised: 'Aktuelle Ausschreibung', available: 'Verfügbare Pfarrstelle', upcoming: 'Vormerkliste / künftige Besetzung' };
    const map = L.map('map').setView([48.6, 9.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);
    const markers = L.markerClusterGroup({ showCoverageOnHover: false }).addTo(map);
    const results = document.querySelector('#list-panel');
    const form = document.querySelector('#filters');
    const mapPanel = document.querySelector('#map-panel');
    const listPanel = document.querySelector('#list-panel');
    const listButton = document.querySelector('#mobile-list');
    const mapButton = document.querySelector('#mobile-map');
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const categoryColors = { advertised: '#b02a37', available: '#146c43', upcoming: '#664d03' };
    let hasExplicitMapState = false;
    const markerFor = (location, category) => L.marker([location.latitude, location.longitude], {
      icon: L.divIcon({ className: 'karte-marker', html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:' + (categoryColors[category] || '#0d6efd') + ';border:2px solid white;box-shadow:0 0 0 1px #333"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
    });
    function render(items) {
      markers.clearLayers();
      results.innerHTML = items.length ? '<div class="table-responsive"><table class="table table-striped align-middle"><caption class="visually-hidden">Gefundene Pfarrstellen</caption><thead><tr><th scope="col">Name</th><th scope="col">Kategorie</th><th scope="col">Ort/Dekanat</th><th scope="col">Frist</th><th scope="col">Quelle</th></tr></thead><tbody>' + items.map((item) => '<tr><th scope="row"><a href="/position/' + encodeURIComponent(item.positionId || item.id) + '">' + escapeHtml(item.name) + '</a><div class="small text-body-secondary">' + escapeHtml(item.type || '') + '</div></th><td><span class="badge text-bg-secondary">' + escapeHtml(categoryLabels[item.category] || 'Unbekannte Kategorie') + '</span></td><td>' + escapeHtml(item.locations.map((location) => location.name).join(', ') || item.deanery || 'Kein Ort angegeben') + '</td><td>' + escapeHtml(item.deadline || 'Keine Frist angegeben') + '</td><td><a href="' + escapeHtml(item.documentUrl || item.source.url) + '">' + escapeHtml(item.source.name) + '</a></td></tr>').join('') + '</tbody></table></div>' : '<p class="alert alert-info">Keine Pfarrstellen gefunden.</p>';
      const located = items.flatMap((item) => item.locations.map((location) => ({ ...location, category: item.category, name: item.name }))).filter((location) => Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)));
      const bounds = [];
      located.forEach((location) => {
        const point = [Number(location.latitude), Number(location.longitude)];
        bounds.push(point);
        markerFor({ ...location, latitude: point[0], longitude: point[1] }, location.category)
          .bindPopup('<strong>' + escapeHtml(location.name) + '</strong><br>' + escapeHtml(categoryLabels[location.category] || 'Unbekannte Kategorie'))
          .addTo(markers);
      });
      if (bounds.length && !hasExplicitMapState) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
    }
    function setView(view) { const list = view === 'list'; mapPanel.classList.toggle('d-none', list); listPanel.classList.toggle('d-none', !list); listButton.classList.toggle('active', list); listButton.classList.toggle('btn-light', list); listButton.classList.toggle('btn-outline-light', !list); listButton.setAttribute('aria-pressed', String(list)); mapButton.classList.toggle('active', !list); mapButton.classList.toggle('btn-light', !list); mapButton.classList.toggle('btn-outline-light', list); mapButton.setAttribute('aria-pressed', String(!list)); if (!list) setTimeout(() => map.invalidateSize(), 0); }
    function currentParams() { return new URLSearchParams([...new FormData(form)].filter(([, value]) => value !== '')); }
    function stateParams() { const params = currentParams(); const center = map.getCenter(); params.set('mapLat', center.lat.toFixed(5)); params.set('mapLng', center.lng.toFixed(5)); params.set('mapZoom', String(map.getZoom())); return params; }
    function replaceUrl() { const params = stateParams(); history.replaceState(null, '', '?' + params); }
    function restoreParams() { const params = new URLSearchParams(window.location.search); for (const control of form.elements) if (control.name && params.has(control.name)) control.value = params.get(control.name); const lat = Number(params.get('mapLat')); const lng = Number(params.get('mapLng')); const zoom = Number(params.get('mapZoom')); hasExplicitMapState = [lat, lng, zoom].every(Number.isFinite) && zoom >= 0 && zoom <= 20 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180; if (hasExplicitMapState) map.setView([lat, lng], zoom); }
    async function load() { const params = stateParams(); replaceUrl(); const response = await fetch('/api/publications?' + new URLSearchParams([...params].filter(([key]) => !key.startsWith('map')))); render((await response.json()).items); }
    restoreParams(); map.on('moveend', replaceUrl); listButton.addEventListener('click', () => setView('list')); mapButton.addEventListener('click', () => setView('map')); form.addEventListener('input', load); load();
  </script>
</body>
</html>`;
}

function publicationItems(database, query) {
  const clauses = [];
  const values = [];
  clauses.push("(l.geocoding_confidence IS NULL OR l.geocoding_confidence <> 'ambiguous')");
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
  if (query.procedure) { clauses.push('pub.appointment_procedure LIKE ?'); values.push(`%${query.procedure}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database.prepare(`
    SELECT pub.id, p.id AS position_id, p.normalized_name AS name, p.type, p.deanery, p.employment_percentage, p.description,
      pub.category, pub.application_deadline, pub.appointment_procedure, pub.published_at, pub.current_state, pub.extraction_confidence,
      l.name AS location_name, l.address, l.latitude, l.longitude, pl.role,
      s.name AS source_name, s.url AS source_url, d.original_url AS document_url, d.fetched_at
    FROM publications pub
    JOIN positions p ON p.id = pub.position_id
    JOIN sources s ON s.id = pub.source_id
    LEFT JOIN documents d ON d.id = pub.document_id
    LEFT JOIN position_locations pl ON pl.position_id = p.id
    LEFT JOIN locations l ON l.id = pl.location_id
    ${where}
    ORDER BY ${query.sort === 'deadline' ? 'pub.application_deadline IS NULL, pub.application_deadline, p.normalized_name' : 'p.normalized_name, pub.category'}, pub.id
  `).all(...values);
  const items = new Map();
  for (const row of rows) {
    if (!items.has(row.id)) items.set(row.id, {
      id: row.id, positionId: row.position_id, name: row.name, category: row.category, type: row.type, deanery: row.deanery,
      employmentPercentage: row.employment_percentage, deadline: row.application_deadline, appointmentProcedure: row.appointment_procedure,
      publishedAt: row.published_at, fetchedAt: row.fetched_at, extractionConfidence: row.extraction_confidence,
      description: row.description, state: row.current_state, locations: [],
      source: { name: row.source_name, url: row.source_url }, documentUrl: row.document_url,
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
  const locations = item.position.locations.length
    ? item.position.locations.map((location) => `<li class="list-group-item"><strong>${escapeHtml(location.name)}</strong>${location.address ? `<br><span class="text-body-secondary">${escapeHtml(location.address)}</span>` : ''}</li>`).join('')
    : '<li class="list-group-item text-body-secondary">Kein Standort angegeben</li>';
  const publications = item.publications.map((publication) => `<article class="card shadow-sm h-100"><div class="card-body"><span class="badge text-bg-secondary mb-2">${escapeHtml(categoryLabel(publication.category))}</span><h3 class="h6 card-title">${escapeHtml(publication.source.name)}</h3><dl class="row small mb-3"><dt class="col-sm-5">Bewerbungsfrist</dt><dd class="col-sm-7">${escapeHtml(publication.deadline || 'Keine Frist angegeben')}</dd><dt class="col-sm-5">Abrufdatum</dt><dd class="col-sm-7"><span>Abgerufen: ${escapeHtml(publication.fetchedAt || 'Nicht angegeben')}</span></dd></dl><a class="btn btn-outline-primary btn-sm" href="${escapeHtml(publication.documentUrl || publication.source.url)}" rel="noopener">Originaldokument öffnen</a><a class="btn btn-link btn-sm" href="${escapeHtml(publication.source.url)}" rel="noopener">Quellseite</a></div></article>`).join('');
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(item.position.name)} – Pfarrstellenkarte</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"><style>.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1rem}.detail-value{font-size:1.05rem;font-weight:600}</style></head>
<body class="bg-body-tertiary">
  <header class="navbar navbar-dark bg-dark shadow-sm"><div class="container"><a class="navbar-brand fw-semibold" href="/">Pfarrstellenkarte</a></div></header>
  <main class="container py-4 py-lg-5">
    <a class="btn btn-link px-0 mb-3" href="/">← Zur Übersicht</a>
    <section class="card border-0 shadow-sm mb-4"><div class="card-body p-4"><div class="d-flex flex-wrap gap-2 mb-3"><span class="badge text-bg-primary">${escapeHtml(item.position.type || 'Pfarrstelle')}</span>${item.position.deanery ? `<span class="badge text-bg-light border">${escapeHtml(item.position.deanery)}</span>` : ''}</div><h1 class="display-6 mb-0">${escapeHtml(item.position.name)}</h1></div></section>
    <div class="detail-grid mb-4">
      <section class="card shadow-sm"><div class="card-body"><h2 class="h5">Stellentyp</h2><div class="detail-value">${escapeHtml(item.position.type || 'Nicht angegeben')}</div></div></section>
      <section class="card shadow-sm"><div class="card-body"><h2 class="h5">Dekanat</h2><div class="detail-value">${escapeHtml(item.position.deanery || 'Nicht angegeben')}</div></div></section>
    </div>
    ${item.position.description ? `<section class="card shadow-sm mb-4"><div class="card-body"><h2 class="h4">Beschreibung</h2><p class="mb-0 text-body-secondary">${escapeHtml(item.position.description)}</p></div></section>` : ''}
    <section class="card shadow-sm mb-4"><div class="card-body"><h2 class="h4">Standorte</h2><ul class="list-group list-group-flush">${locations}</ul></div></section>
    <section class="mb-4"><h2 class="h4 mb-3">Veröffentlichungen und Quellen</h2><div class="row g-3">${publications}</div></section>
    <p class="alert alert-warning"><strong>Hinweis:</strong> Diese Übersicht ist unoffiziell. Maßgeblich sind die originalen ELKW-Dokumente.</p>
  </main>
</body>
</html>`;
}

export function buildServer({ database = null, adminToken = config.adminToken, importRunner = null } = {}) {
  const server = Fastify({ logger: true });
  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin/')) return;
    if (!adminToken) return reply.code(503).send({ error: 'Admin access is not configured' });
    const authorization = request.headers.authorization ?? '';
    if (authorization !== `Bearer ${adminToken}`) return reply.code(401).send({ error: 'Unauthorized' });
  });
  server.get('/health', async () => ({
    status: 'ok',
    lastSuccessfulImport: database
      ? database.prepare("SELECT id, source_id, completed_at, counts_json FROM import_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get() ?? null
      : null,
    unresolvedIssues: database
      ? database.prepare('SELECT COUNT(*) AS count FROM import_issues WHERE resolved_at IS NULL').get().count
      : 0,
  }));
  server.get('/', async (_, reply) => reply.type('text/html').send(publicPage()));
  server.get('/api/publications', async (request) => ({ items: database ? publicationItems(database, request.query) : [] }));
  server.get('/api/positions/:id', async (request, reply) => {
    const items = database ? publicationItems(database, { positionId: request.params.id }) : [];
    if (!items.length) return reply.code(404).send({ error: 'Position not found' });
    return {
      position: { id: Number(request.params.id), name: items[0].name, type: items[0].type, deanery: items[0].deanery, description: items[0].description, locations: items[0].locations },
      publications: items,
    };
  });
  server.get('/position/:id', async (request, reply) => {
    const items = database ? publicationItems(database, { positionId: request.params.id }) : [];
    if (!items.length) return reply.code(404).send({ error: 'Position not found' });
    return reply.type('text/html').send(positionDetailPage({
      position: { name: items[0].name, type: items[0].type, deanery: items[0].deanery, description: items[0].description, locations: items[0].locations },
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
  server.get('/admin/imports', async () => ({ imports: database
    ? database.prepare('SELECT id, source_id, started_at, completed_at, status, counts_json, error_summary FROM import_runs ORDER BY id DESC LIMIT 100').all()
    : [] }));
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
