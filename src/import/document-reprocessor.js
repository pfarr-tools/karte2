/**
 * Re-extract one stored document. The original PDF/hash remains untouched.
 */
export async function reprocessDocument({ database, documentId, extractDocumentImpl }) {
  const document = database.prepare('SELECT id, local_path, sha256 FROM documents WHERE id = ?').get(documentId);
  if (!document) throw new Error(`Document not found: ${documentId}`);
  const textPath = document.local_path.replace(/\.pdf$/i, '.txt');
  try {
    const extraction = await extractDocumentImpl({ documentId: document.id, pdfPath: document.local_path, textPath });
    database.prepare('UPDATE documents SET extracted_text_path = ?, extraction_status = ?, metadata_json = ? WHERE id = ?')
      .run(extraction.textPath, 'success', JSON.stringify({ pageCount: extraction.pageCount }), document.id);
    return { documentId: document.id, status: 'success', textPath: extraction.textPath };
  } catch (error) {
    database.prepare('UPDATE documents SET extraction_status = ?, metadata_json = ? WHERE id = ?')
      .run('failed', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), document.id);
    return { documentId: document.id, status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
