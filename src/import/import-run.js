import { parseElkwListingPage } from './elkw-page-parser.js';
import { parseVacancyText } from './vacancy-text-parser.js';

function recordIssue(database, importRunId, issue) {
  database.prepare(`
    INSERT INTO import_issues (import_run_id, document_id, severity, code, message, context_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(importRunId, issue.documentId ?? null, issue.severity ?? 'error', issue.code, issue.message, JSON.stringify(issue.context ?? {}));
}

function stableSlug(name) {
  return name.toLocaleLowerCase('de').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueStableSlug(database, name, positionId) {
  const base = stableSlug(name) || 'unbenannte-pfarrstelle';
  const conflict = database.prepare('SELECT id FROM positions WHERE stable_slug = ? AND id <> ? LIMIT 1')
    .get(base, positionId);
  return conflict ? `${base}-${positionId}` : base;
}

function updateImportedPosition(database, positionId, parsed) {
  database.prepare('UPDATE positions SET stable_slug = ?, normalized_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(uniqueStableSlug(database, parsed.name, positionId), parsed.normalizedName, positionId);
  const importedFields = {
    type: parsed.type,
    deanery: parsed.deanery,
    employment_percentage: parsed.employmentPercentage,
    employment_description: parsed.employmentDescription,
    description: parsed.description,
  };
  for (const [fieldName, value] of Object.entries(importedFields)) {
    const overridden = database.prepare('SELECT override_value FROM position_overrides WHERE position_id = ? AND field_name = ?').get(positionId, fieldName);
    database.prepare(`UPDATE positions SET ${fieldName} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(overridden?.override_value ?? value, positionId);
  }
}

function ensurePositionLocation(database, positionId, locationName, { replaceUnresolved = false } = {}) {
  if (!locationName) return;
  const existing = database.prepare('SELECT id FROM locations WHERE name = ? AND address IS NULL').get(locationName);
  let locationId = existing?.id;
  if (!locationId) {
    const linkedLocations = database.prepare(`
      SELECT l.id, l.latitude, l.longitude, l.geocoding_confidence
      FROM position_locations pl
      JOIN locations l ON l.id = pl.location_id
      WHERE pl.position_id = ? AND pl.role = 'duty'
    `).all(positionId);
    const replaceable = replaceUnresolved
      && linkedLocations.length === 1
      && linkedLocations[0].latitude === null
      && linkedLocations[0].longitude === null
      && ['ambiguous', 'not-found', null].includes(linkedLocations[0].geocoding_confidence);
    if (replaceable) {
      locationId = linkedLocations[0].id;
      database.prepare('UPDATE locations SET name = ?, address = NULL, geocoding_provider = NULL, geocoding_confidence = NULL, verified_at = NULL WHERE id = ?').run(locationName, locationId);
    } else {
      locationId = database.prepare('INSERT INTO locations (name) VALUES (?)').run(locationName).lastInsertRowid;
    }
  }
  database.prepare('INSERT OR IGNORE INTO position_locations (position_id, location_id, role) VALUES (?, ?, ?)').run(positionId, locationId, 'duty');
}

function persistPublication(database, { candidate, section, documentId, extractedText, observedAt }) {
  const parsed = parseVacancyText({ title: candidate.title, text: extractedText });
  let position = database.prepare(`
    SELECT p.id FROM positions p
    JOIN publications existing_publication ON existing_publication.position_id = p.id
    WHERE existing_publication.document_id = ?
    ORDER BY existing_publication.id
    LIMIT 1
  `).get(documentId);
  position ??= database.prepare('SELECT id FROM positions WHERE normalized_name = ?').get(parsed.normalizedName);
  if (!position) {
    const baseSlug = stableSlug(parsed.name) || 'unbenannte-pfarrstelle';
    const occupied = database.prepare('SELECT id FROM positions WHERE stable_slug = ? LIMIT 1').get(baseSlug);
    const locationId = parsed.locationName
      ? database.prepare('INSERT INTO locations (name) VALUES (?)').run(parsed.locationName).lastInsertRowid
      : null;
    const inserted = database.prepare(`
      INSERT INTO positions (stable_slug, normalized_name, type, deanery, employment_percentage, employment_description, description, primary_location_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      occupied ? `${baseSlug}-document-${documentId}` : baseSlug, parsed.normalizedName, parsed.type, parsed.deanery, parsed.employmentPercentage,
      parsed.employmentDescription, parsed.description, locationId,
    );
    position = { id: Number(inserted.lastInsertRowid) };
    database.prepare('UPDATE positions SET stable_slug = ? WHERE id = ?')
      .run(uniqueStableSlug(database, parsed.name, position.id), position.id);
    if (locationId) database.prepare('INSERT INTO position_locations (position_id, location_id, role) VALUES (?, ?, ?)').run(position.id, locationId, 'duty');
  } else {
    updateImportedPosition(database, position.id, parsed);
    const isDocumentReprocessing = Boolean(database.prepare(
      'SELECT id FROM publications WHERE document_id = ? LIMIT 1',
    ).get(documentId));
    ensurePositionLocation(database, position.id, parsed.locationName, { replaceUnresolved: isDocumentReprocessing });
  }

  const existingPublication = database.prepare(`
    SELECT id FROM publications WHERE position_id = ? AND document_id = ? AND category = ?
  `).get(position.id, documentId, section.category);
  if (existingPublication) return { positionId: position.id, publicationId: existingPublication.id, parsed };

  const publicationId = Number(database.prepare(`
    INSERT INTO publications (position_id, source_id, section_id, document_id, category, application_deadline, appointment_procedure, first_seen_at, last_seen_at, current_state, extraction_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?)
  `).run(
    position.id, candidate.sourceId, section.id, documentId, section.category, section.deadline, parsed.appointmentProcedure, observedAt, observedAt, parsed.confidence,
  ).lastInsertRowid);
  const insertField = database.prepare(`
    INSERT INTO extracted_fields (publication_id, field_name, raw_value, normalized_value, confidence)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const [fieldName, value] of Object.entries({
    name: parsed.name, deanery: parsed.deanery, employment_percentage: parsed.employmentPercentage, location: parsed.locationName,
  })) {
    if (value !== null) insertField.run(publicationId, fieldName, String(value), String(value), parsed.confidence);
  }
  return { positionId: position.id, publicationId, parsed };
}

/**
 * @param {{database: import('better-sqlite3').Database, html: string, sourceId: string, pageUrl: string, observedAt: string, downloadDocumentImpl: Function, extractDocumentImpl?: Function}} options
 */
export async function runPageImport({ database, html, sourceId, pageUrl, observedAt, downloadDocumentImpl, extractDocumentImpl, force = false }) {
  const importRun = database.prepare(`
    INSERT INTO import_runs (source_id, started_at, status, counts_json)
    VALUES (?, ?, 'running', '{}')
  `).run(sourceId, observedAt);
  const importRunId = Number(importRun.lastInsertRowid);
  const counts = { sections: 0, documents: 0, failedDocuments: 0 };
  const issues = [];

  try {
    const parsed = parseElkwListingPage(html, { sourceId, pageUrl, observedAt });
    for (const issue of parsed.issues) {
      const normalized = { code: issue.code, message: issue.code, context: issue };
      issues.push(normalized);
      recordIssue(database, importRunId, normalized);
    }
    const knownDocuments = database.prepare('SELECT COUNT(*) AS count FROM documents WHERE source_id = ?').get(sourceId).count;
    if (parsed.documents.length === 0 && knownDocuments > 0) {
      const anomaly = {
        code: 'source-result-empty',
        severity: 'warning',
        message: 'Source page contained no PDF documents although previous documents exist',
        context: { previousDocuments: knownDocuments },
      };
      issues.push(anomaly);
      recordIssue(database, importRunId, anomaly);
    }

    const findSection = database.prepare(`
      SELECT id FROM source_sections
      WHERE source_id = ? AND category = ? AND label = ?
        AND ((round IS NULL AND ? IS NULL) OR round = ?)
    `);
    const insertSection = database.prepare(`
      INSERT INTO source_sections (source_id, label, category, round, deadline, observed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateSection = database.prepare(`
      UPDATE source_sections SET deadline = ?, observed_at = ? WHERE id = ?
    `);
    const sectionIds = new Map();
    const sectionsByKey = new Map(parsed.sections.map((section) => [section.key, section]));
    for (const section of parsed.sections) {
      const existing = findSection.get(sourceId, section.category, section.label, section.round, section.round);
      const id = existing?.id ?? insertSection.run(
        sourceId, section.label, section.category, section.round, section.deadline, observedAt,
      ).lastInsertRowid;
      if (existing) updateSection.run(section.deadline, observedAt, id);
      sectionIds.set(section.key, Number(id));
      counts.sections += 1;
    }

    const findDocument = database.prepare(`
      SELECT id, local_path FROM documents WHERE source_id = ? AND original_url = ? AND sha256 = ?
    `);
    const insertDocument = database.prepare(`
      INSERT INTO documents (source_id, original_url, local_path, sha256, mime_type, fetched_at, extraction_status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    const updateExtraction = database.prepare(`
      UPDATE documents SET extracted_text_path = ?, extraction_status = ?, metadata_json = ? WHERE id = ?
    `);
    for (const candidate of parsed.documents) {
      try {
        const artifact = await downloadDocumentImpl({ url: candidate.originalUrl, sourceId });
        const existing = findDocument.get(sourceId, artifact.originalUrl, artifact.sha256);
        const documentId = existing?.id ?? Number(insertDocument.run(
            sourceId,
            artifact.originalUrl,
            artifact.localPath,
            artifact.sha256,
            artifact.mimeType,
            artifact.fetchedAt,
          ).lastInsertRowid);
        if (!existing) {
          counts.documents += 1;
        }
        if (extractDocumentImpl && (!existing || force)) {
          const storedDocument = existing ?? { local_path: artifact.localPath };
          const textPath = storedDocument.local_path.replace(/([\\/])documents([\\/])([^\\/]+)\.pdf$/i, '$1documents$2$3.txt');
            try {
              const extraction = await extractDocumentImpl({
                documentId,
                pdfPath: artifact.localPath,
                textPath,
              });
              updateExtraction.run(
                extraction.textPath,
                'success',
                JSON.stringify({ pageCount: extraction.pageCount }),
                documentId,
              );
              const section = sectionsByKey.get(candidate.sectionKey);
              if (section) persistPublication(database, {
                candidate,
                section: { ...section, id: sectionIds.get(candidate.sectionKey) },
                documentId,
                extractedText: extraction.text,
                observedAt,
              });
            } catch (error) {
              updateExtraction.run(null, 'failed', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), documentId);
              const issue = {
                code: 'document-extraction-failed',
                message: error instanceof Error ? error.message : String(error),
                documentId,
                context: { url: artifact.originalUrl },
              };
              issues.push(issue);
              recordIssue(database, importRunId, issue);
            }
        }
      } catch (error) {
        const issue = {
          code: 'document-download-failed',
          message: error instanceof Error ? error.message : String(error),
          context: { url: candidate.originalUrl, sectionId: sectionIds.get(candidate.sectionKey) ?? null },
        };
        issues.push(issue);
        counts.failedDocuments += 1;
        recordIssue(database, importRunId, issue);
      }
    }

    database.prepare(`
      UPDATE import_runs SET completed_at = ?, status = 'completed', counts_json = ? WHERE id = ?
    `).run(observedAt, JSON.stringify(counts), importRunId);
    return { importRunId, status: 'completed', counts, issues };
  } catch (error) {
    const issue = { code: 'import-run-failed', message: error instanceof Error ? error.message : String(error), context: {} };
    recordIssue(database, importRunId, issue);
    database.prepare(`
      UPDATE import_runs SET completed_at = ?, status = 'failed', counts_json = ?, error_summary = ? WHERE id = ?
    `).run(observedAt, JSON.stringify(counts), issue.message, importRunId);
    throw error;
  }
}
