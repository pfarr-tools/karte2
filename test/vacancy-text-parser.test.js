import { describe, expect, it } from 'vitest';
import { parseVacancyText } from '../src/import/vacancy-text-parser.js';

describe('vacancy text parser', () => {
  it('extracts conservative structured fields from a representative text', () => {
    const result = parseVacancyText({
      title: 'Pfarrstelle Beispielort',
      text: `Pfarrstelle Beispielort\nDekanat: Musterhausen\nDienstsitz: Beispielort\n75 %\n`,
    });

    expect(result).toMatchObject({
      name: 'Pfarrstelle Beispielort',
      normalizedName: 'pfarrstelle beispielort',
      type: 'Pfarrstelle',
      deanery: 'Musterhausen',
      employmentPercentage: 75,
      locationName: 'Beispielort',
      confidence: 'high',
    });
  });

  it('keeps uncertain fields null instead of guessing', () => {
    expect(parseVacancyText({ title: 'Sonderauftrag', text: 'Weitere Informationen folgen.' })).toMatchObject({
      name: 'Sonderauftrag',
      type: null,
      deanery: null,
      employmentPercentage: null,
      locationName: null,
      confidence: 'low',
    });
  });
});
