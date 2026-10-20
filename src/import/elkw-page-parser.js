import * as cheerio from 'cheerio';

const months = new Map([
  ['januar', 1], ['februar', 2], ['märz', 3], ['april', 4], ['mai', 5], ['juni', 6],
  ['juli', 7], ['august', 8], ['september', 9], ['oktober', 10], ['november', 11], ['dezember', 12],
]);

function parseGermanDate(value) {
  const match = value.toLocaleLowerCase('de').match(/(\d{1,2})\.\s*([a-zä]+)\s+(\d{4})/);
  if (!match) return null;
  const month = months.get(match[2]);
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
}

function categoryForHeading(text) {
  const normalized = text.toLocaleLowerCase('de');
  if (normalized.includes('aktuelle ausschreibungen')) return 'advertised';
  if (/verfügbar(?:e|en)\s+pfarrstellen/.test(normalized)) return 'available';
  if (normalized.includes('liste zu besetzender pfarrstellen')) return 'upcoming';
  return null;
}

function roundForHeading(text) {
  const match = text.match(/zum\s+(\d{1,2}\.\s*[A-Za-zÄÖÜäöü]+\s+\d{4})\s*-\s*Bewerbungsschluss\s+zum\s+(\d{1,2}\.\s*[A-Za-zÄÖÜäöü]+\s+\d{4})/i);
  if (!match) return null;
  return { round: parseGermanDate(match[1]), deadline: parseGermanDate(match[2]) };
}

function sectionKey(category, round) {
  return `${category}:${round ?? 'default'}`;
}

function titleFromLink(text) {
  return text
    .replace(/\s*\((?:PDF|DOCX)\)(?:\s*[\d.,]+\s*(?:KB|MB|GB))?\s*$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+(?:Dekan(?:at|ats)?(?:amt)?|Kirchenbezirk)\b.*$/i, '')
    .replace(/\s+(?:WV|BV)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} html
 * @param {{sourceId: string, pageUrl: string, observedAt: string}} options
 * @returns {{sections: Array<object>, documents: Array<object>, issues: Array<object>}}
 */
export function parseElkwListingPage(html, { sourceId, pageUrl, observedAt }) {
  const $ = cheerio.load(html);
  const sections = new Map();
  const documents = [];
  const issues = [];
  let category = null;
  let currentSection = null;

  $('h1, h2, h3, h4, a').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (!text) return;

    if (['H1', 'H2', 'H3', 'H4'].includes(element.name.toUpperCase())) {
      const headingCategory = categoryForHeading(text);
      if (headingCategory) {
        category = headingCategory;
        const round = null;
        currentSection = {
          key: sectionKey(category, round),
          sourceId,
          label: text,
          category,
          round,
          deadline: null,
          observedAt,
        };
        sections.set(currentSection.key, currentSection);
        return;
      }

      const headingLevel = Number(element.name.slice(1));
      if (headingLevel <= 2) {
        const remainsAdvertised = category === 'advertised' && text.toLocaleLowerCase('de').includes('ausschreibungen');
        category = remainsAdvertised ? category : null;
        currentSection = null;
      }

      if (category === 'advertised') {
        const parsedRound = roundForHeading(text);
        if (parsedRound?.round) {
          const defaultKey = sectionKey(category, null);
          if (!documents.some((document) => document.sectionKey === defaultKey)) sections.delete(defaultKey);
          currentSection = {
            key: sectionKey(category, parsedRound.round),
            sourceId,
            label: text,
            category,
            round: parsedRound.round,
            deadline: parsedRound.deadline,
            observedAt,
          };
          sections.set(currentSection.key, currentSection);
        }
      }
      return;
    }

    if (!element.attribs?.href) return;
    let originalUrl;
    try {
      originalUrl = new URL(element.attribs.href, pageUrl).toString();
    } catch {
      issues.push({ code: 'invalid-url', sourceId, url: element.attribs.href, observedAt });
      return;
    }
    if (!new URL(originalUrl).pathname.toLocaleLowerCase('de').endsWith('.pdf')) return;

    if (!currentSection || !category) {
      issues.push({ code: 'unrecognized-pdf-context', sourceId, url: originalUrl, observedAt });
      return;
    }

    documents.push({ sourceId, sectionKey: currentSection.key, title: titleFromLink(text), originalUrl, observedAt });
  });

  return { sections: [...sections.values()], documents, issues };
}
