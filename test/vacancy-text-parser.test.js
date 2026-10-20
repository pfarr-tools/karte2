import { describe, expect, it } from 'vitest';
import { parseVacancyText } from '../src/import/vacancy-text-parser.js';

describe('vacancy text parser', () => {
  it('restores readable German capitalization for all-lowercase imported titles', () => {
    expect(parseVacancyText({
      title: 'transformationspfarrstelle im kirchenbezirk weinsberg-neuenstadt',
      text: '',
    }).name).toBe('Transformationspfarrstelle im Kirchenbezirk Weinsberg-Neuenstadt');
  });

  it('prefers the document heading over a transliterated listing slug', () => {
    expect(parseVacancyText({
      title: 'Gaechingen',
      text: 'Pfarrstelle Gächingen\nDekanat: Münsingen\nDienstsitz: Gächingen\n',
    }).name).toBe('Pfarrstelle Gächingen');
  });

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

  it('does not treat incidental prose ending in Ort as a location label', () => {
    expect(parseVacancyText({
      title: 'Pfarrstelle Beispielort',
      text: 'Pfarrstelle Beispielort\nEine Schule und Einkaufsmöglichkeit vor Ort: vorhanden.\n',
    }).locationName).toBe('Beispielort');
  });

  it('normalizes names for deterministic cross-document matching', () => {
    expect(parseVacancyText({
      title: 'Pfarrstelle  Müll­er-Vogt',
      text: 'Pfarrstelle Müll­er-Vogt',
    }).normalizedName).toBe('pfarrstelle muller vogt');
  });

  it('extracts an explicitly labelled appointment procedure', () => {
    expect(parseVacancyText({
      title: 'Pfarrstelle Beispielort',
      text: 'Bewerbungsverfahren: Wahl durch den Kirchengemeinderat',
    }).appointmentProcedure).toBe('Wahl durch den Kirchengemeinderat');
  });
});
