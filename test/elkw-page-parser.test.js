import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseElkwListingPage } from '../src/import/elkw-page-parser.js';

const html = fs.readFileSync(new URL('./fixtures/elkw-listing-page.html', import.meta.url), 'utf8');
const options = {
  sourceId: 'elkw-pfarrstellen',
  pageUrl: 'https://www.elk-wue.de/wir/pfarrstellen',
  observedAt: '2026-10-19T12:00:00Z',
};

describe('ELKW listing page parser', () => {
  it('discovers all recognized publication categories and preserves round context', () => {
    const result = parseElkwListingPage(html, options);

    expect(result.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'advertised:2026-10-15', category: 'advertised', deadline: '2026-11-05' }),
      expect.objectContaining({ category: 'available', round: null, deadline: null }),
      expect.objectContaining({ category: 'upcoming', round: null, deadline: null }),
    ]));
    expect(result.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'elkw-pfarrstellen',
        sectionKey: 'advertised:2026-10-15',
        title: 'Atzenweiler-Vogt',
        originalUrl: 'https://www.elk-wue.de/downloads/atzenweiler.pdf',
      }),
      expect.objectContaining({
        sectionKey: expect.stringContaining('available'),
        originalUrl: 'https://www.elk-wue.de/wir/downloads/altenheimseelsorge.pdf',
      }),
    ]));
  });

  it('ignores non-PDF links and reports PDFs outside recognized categories', () => {
    const result = parseElkwListingPage(html, options);

    expect(result.documents.some(({ originalUrl }) => originalUrl.endsWith('.docx'))).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unrecognized-pdf-context', url: 'https://www.elk-wue.de/downloads/orphan.pdf' }),
      expect.objectContaining({ code: 'unrecognized-pdf-context', url: 'https://www.elk-wue.de/downloads/contact.pdf' }),
    ]));
  });

  it('keeps direct PDFs under advertised listings without a round heading', () => {
    const result = parseElkwListingPage(`
      <h2>Aktuelle Ausschreibungen</h2>
      <a href="/downloads/direkt.pdf">Direkte Stelle (PDF)</a>
    `, options);

    expect(result.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'advertised:default', category: 'advertised', round: null }),
    ]));
    expect(result.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ sectionKey: 'advertised:default', originalUrl: 'https://www.elk-wue.de/downloads/direkt.pdf' }),
    ]));
    expect(result.issues).toEqual([]);
  });

  it('keeps available context after the source page structural heading', () => {
    const result = parseElkwListingPage(`
      <h2>Aktuelle Ausschreibungen</h2>
      <h3>Ausschreibungen zum 15. Oktober 2026 - Bewerbungsschluss zum 5. November 2026</h3>
      <a href="/downloads/aktuell.pdf">Aktuelle Stelle (PDF)</a>
      <h2>Ausschreibungstexte der verfügbaren Pfarrstellen</h2>
      <a href="/downloads/verfuegbar.pdf">Verfügbare Stelle (PDF)</a>
    `, options);

    expect(result.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sectionKey: 'available:default',
        originalUrl: 'https://www.elk-wue.de/downloads/verfuegbar.pdf',
      }),
    ]));
    expect(result.issues).toEqual([]);
  });
});
