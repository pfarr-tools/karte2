import { parseElkwListingPage } from './elkw-page-parser.js';

function recordIssue(database, importRunId, issue) {
  database.prepare(`
    INSERT INTO import_issues (import_run_id, document_id, severity, code, message, context_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(importRunId, issue.documentId ?? null, issue.severity ?? 'error', issue.code, issue.message, JSON.stringify(issue.context ?? {}));
}

/**
 * @param {{database: import('better-sqlite3').Database, html: string, sourceId: string, pageUrl: string, observedAt: string, downloadDocumentImpl: Function, extractDocumentImpl?: Function}} options
 */
export async function runPageImport({ database, html, sourceId, pageUrl, observedAt, downloadDocumentImpl, extractDocumentImpl }) {
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
      SELECT id FROM documents WHERE source_id = ? AND original_url = ? AND sha256 = ?
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
        if (!existing) {
          const documentId = Number(insertDocument.run(
            sourceId,
            artifact.originalUrl,
            artifact.localPath,
            artifact.sha256,
            artifact.mimeType,
            artifact.fetchedAt,
          ).lastInsertRowid);
          counts.documents += 1;
          if (extractDocumentImpl) {
            const textPath = artifact.localPath.replace(/([\\/])documents([\\/])([^\\/]+)\.pdf$/i, '$1documents$2$3.txt');
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
