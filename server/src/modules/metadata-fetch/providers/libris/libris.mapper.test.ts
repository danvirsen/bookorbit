import { MetadataProviderKey } from '@bookorbit/types';

import { AUDIOBOOK_RECORD, TITANENS_RECORD } from './libris-test-fixtures';
import {
  extractLibrisBibId,
  extractLibrisFindIds,
  extractLibrisId,
  mapLibrisRecord,
  parseDurationSeconds,
  parsePageCount,
  parseSeriesEnumeration,
} from './libris.mapper';

describe('mapLibrisRecord', () => {
  it('maps a print record with linked work, people and genres', () => {
    expect(mapLibrisRecord(TITANENS_RECORD, 'ctv82fx49rndh4z7')).toEqual({
      provider: MetadataProviderKey.LIBRIS,
      providerId: 'ctv82fx49rndh4z7',
      title: 'Titanens förbannelse',
      subtitle: undefined,
      authors: ['Rick Riordan'],
      narrators: undefined,
      description: 'Halvguden Percy Jackson får ett nödanrop från sin gode vän Grover. ”Titanens förbannelse” är den tredje boken om Percy Jackson.',
      publisher: 'Bonnier Carlsen',
      publishedYear: 2023,
      language: 'sv',
      pageCount: 366,
      durationSeconds: undefined,
      isbn10: undefined,
      isbn13: '9789179793098',
      seriesName: 'Percy Jackson',
      seriesIndex: '3',
      genres: ['Ungdomsböcker', 'Fantasy'],
      sourceUrl: 'https://libris.kb.se/ctv82fx49rndh4z7',
    });
  });

  it('maps an audiobook with an inline work, narrator and duration', () => {
    const result = mapLibrisRecord(AUDIOBOOK_RECORD, 'abcd1234efgh5678');
    expect(result).toMatchObject({
      title: 'Bröderna Lejonhjärta',
      subtitle: 'ljudbok',
      authors: ['Astrid Lindgren'],
      narrators: ['Astrid Lindgren'],
      language: 'sv',
      publishedYear: 2019,
      durationSeconds: (8 * 60 + 12) * 60,
      isbn10: '9129657305',
      isbn13: '9789129723891',
      genres: ['Fantasy'],
    });
    expect(result?.pageCount).toBeUndefined();
    expect(result?.coverUrl).toBeUndefined();
  });

  it('leaves out the linked cover, which Libris serves only through signed links', () => {
    expect(TITANENS_RECORD['@graph']?.[1]).toHaveProperty('image');
    expect(mapLibrisRecord(TITANENS_RECORD, 'ctv82fx49rndh4z7')).not.toHaveProperty('coverUrl');
  });

  it('returns null when the record has no matching instance', () => {
    expect(mapLibrisRecord(TITANENS_RECORD, 'zzzzzzzzzzzzzzzz')).toBeNull();
    expect(mapLibrisRecord({}, 'ctv82fx49rndh4z7')).toBeNull();
  });
});

describe('libris mapper helpers', () => {
  it('extracts XL ids from ids, URIs and catalog URLs', () => {
    expect(extractLibrisId('ctv82fx49rndh4z7')).toBe('ctv82fx49rndh4z7');
    expect(extractLibrisId('https://libris.kb.se/ctv82fx49rndh4z7#it')).toBe('ctv82fx49rndh4z7');
    expect(extractLibrisId('https://libris.kb.se/katalogisering/ctv82fx49rndh4z7')).toBe('ctv82fx49rndh4z7');
    expect(extractLibrisId('http://libris.kb.se/bib/12504697')).toBeNull();
    expect(extractLibrisId('12504697')).toBeNull();
    expect(extractLibrisId('')).toBeNull();
  });

  it('extracts pre-XL numeric bib ids', () => {
    expect(extractLibrisBibId('12504697')).toBe('12504697');
    expect(extractLibrisBibId('http://libris.kb.se/bib/12504697')).toBe('12504697');
    expect(extractLibrisBibId('http://libris.kb.se/resource/bib/12504697')).toBe('12504697');
    expect(extractLibrisBibId('ctv82fx49rndh4z7')).toBeNull();
  });

  it('collects unique ids from a find response', () => {
    expect(
      extractLibrisFindIds([{ '@id': 'https://libris.kb.se/ctv82fx49rndh4z7#it' }, { '@id': 'https://libris.kb.se/ctv82fx49rndh4z7#it' }, {}]),
    ).toEqual(['ctv82fx49rndh4z7']);
  });

  it('parses page counts, durations and series positions', () => {
    expect(parsePageCount(['366 s.'])).toBe(366);
    expect(parsePageCount(['1 ljudfil'])).toBeUndefined();
    expect(parseDurationSeconds(['1 ljudfil (ca 45 min.)'])).toBe(45 * 60);
    expect(parseDurationSeconds(['366 sidor'])).toBeUndefined();
    expect(parseSeriesEnumeration('Del 2')).toBe('2');
    expect(parseSeriesEnumeration('3:e boken')).toBe('3');
    expect(parseSeriesEnumeration(undefined)).toBeUndefined();
  });
});
