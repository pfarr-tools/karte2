function clean(value) {
  return value?.replace(/\s+/g, ' ').trim() || null;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

/**
 * Parse only explicit, stable labels from extracted vacancy text.
 * Missing values remain null; this parser deliberately does not infer locations.
 * @param {{title?: string, text: string}} input
 */
export function parseVacancyText({ title, text }) {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const name = clean(title) || lines[0] || 'Unbenannte Pfarrstelle';
  const type = /\bpfarrstelle\b/i.test(name) || /\bpfarrstelle\b/i.test(text) ? 'Pfarrstelle' : null;
  const deanery = firstMatch(text, [
    /(?:Dekan(?:at|ats)|Kirchenbezirk)\s*:\s*([^\n]+)/i,
    /(?:Dekan(?:at|ats)|Kirchenbezirk)\s+([^\n]+)/i,
  ]);
  const locationName = firstMatch(text, [
    /(?:Dienstsitz|Dienstort|Ort)\s*:\s*([^\n]+)/i,
  ]);
  const percentageMatch = text.match(/(?:umfang|beschäftigungsumfang|stellenumfang)?[^\n]{0,30}?(\d{1,3})\s*%/i);
  const employmentPercentage = percentageMatch ? Number(percentageMatch[1]) : null;
  const fieldCount = [type, deanery, locationName, employmentPercentage].filter((value) => value !== null).length;

  return {
    name,
    normalizedName: name.toLocaleLowerCase('de'),
    type,
    deanery,
    employmentPercentage,
    locationName,
    employmentDescription: employmentPercentage === null ? null : `${employmentPercentage} %`,
    description: clean(lines.slice(1).join(' ')),
    confidence: fieldCount >= 3 ? 'high' : fieldCount >= 1 ? 'medium' : 'low',
  };
}
