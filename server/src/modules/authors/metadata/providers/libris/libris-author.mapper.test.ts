import { extractLibrisAuthorId, findLibrisPerson, parseLibrisLifeSpan, parseLibrisPerson, parseWikidataImageFile } from './libris-author.mapper';

function person(overrides: Record<string, unknown> = {}) {
  return {
    '@id': 'https://libris.kb.se/fcrtpljz1qp2bdv#it',
    '@type': 'Person',
    givenName: 'Astrid',
    familyName: 'Lindgren',
    lifeSpan: '1907-2002',
    description: ['Skönlitterär författare av barn- och ungdomsböcker.', 'Född  Ericsson.'],
    ...overrides,
  };
}

describe('parseLibrisPerson', () => {
  it('extracts the full record from a person node', () => {
    expect(parseLibrisPerson(person())).toEqual({
      providerId: 'fcrtpljz1qp2bdv',
      name: 'Astrid Lindgren',
      description: 'Skönlitterär författare av barn- och ungdomsböcker. Född Ericsson.',
      birthYear: 1907,
      deathYear: 2002,
    });
  });

  it('falls back to the plain name when the person has no given and family name', () => {
    const parsed = parseLibrisPerson(person({ givenName: undefined, familyName: undefined, name: 'Sapfo' }));

    expect(parsed?.name).toBe('Sapfo');
  });

  it('leaves the description out when the person has none', () => {
    expect(parseLibrisPerson(person({ description: undefined }))?.description).toBeUndefined();
  });

  it('keeps the Wikidata id only for a person Libris has a photo for', () => {
    const exactMatch = [{ '@id': 'http://dbpedia.org/resource/Astrid_Lindgren' }, { '@id': 'http://www.wikidata.org/entity/Q55767' }];
    const image = [{ '@id': 'https://libris.kb.se/dataset/images/d4dd60f76e1dfbe1a327cb06f1a1cee3.full.jpg' }];

    expect(parseLibrisPerson(person({ exactMatch, image }))?.wikidataId).toBe('Q55767');
    expect(parseLibrisPerson(person({ exactMatch }))?.wikidataId).toBeUndefined();
    expect(parseLibrisPerson(person({ image }))?.wikidataId).toBeUndefined();
  });

  it('rejects nodes that are not a usable person', () => {
    expect(parseLibrisPerson(person({ '@type': 'Organization' }))).toBeNull();
    expect(parseLibrisPerson(person({ '@id': undefined }))).toBeNull();
    expect(parseLibrisPerson(person({ givenName: undefined, familyName: undefined }))).toBeNull();
    expect(parseLibrisPerson(null)).toBeNull();
  });
});

describe('parseLibrisLifeSpan', () => {
  it.each([
    ['1907-2002', { birthYear: 1907, deathYear: 2002 }],
    ['1934-', { birthYear: 1934, deathYear: undefined }],
    ['-1650', { birthYear: undefined, deathYear: 1650 }],
    [['1907-2002', '1907-'], { birthYear: 1907, deathYear: 2002 }],
    ['1800-talet', {}],
    [undefined, {}],
  ])('parses %j', (value, expected) => {
    expect(parseLibrisLifeSpan(value)).toEqual(expected);
  });
});

describe('extractLibrisAuthorId', () => {
  it('accepts a bare id, a record URL and a person URL', () => {
    expect(extractLibrisAuthorId('fcrtpljz1qp2bdv')).toBe('fcrtpljz1qp2bdv');
    expect(extractLibrisAuthorId(' https://libris.kb.se/fcrtpljz1qp2bdv ')).toBe('fcrtpljz1qp2bdv');
    expect(extractLibrisAuthorId('https://libris.kb.se/fcrtpljz1qp2bdv#it')).toBe('fcrtpljz1qp2bdv');
    expect(extractLibrisAuthorId('https://libris.kb.se/katalogisering/fcrtpljz1qp2bdv')).toBe('fcrtpljz1qp2bdv');
  });

  it('rejects pre-XL numeric ids and blanks', () => {
    expect(extractLibrisAuthorId('71639')).toBeNull();
    expect(extractLibrisAuthorId('   ')).toBeNull();
    expect(extractLibrisAuthorId(undefined)).toBeNull();
  });
});

describe('findLibrisPerson', () => {
  it('picks the person by its own id rather than a linked card', () => {
    const linked = person({ '@id': 'https://libris.kb.se/rp3698v938cs2l0#it', givenName: 'Marianne' });
    const record = { '@graph': [linked, { '@id': 'https://libris.kb.se/fcrtpljz1qp2bdv', '@type': 'Record' }, person()] };

    expect(findLibrisPerson(record, 'fcrtpljz1qp2bdv')?.givenName).toBe('Astrid');
  });

  it('returns null when the record holds no matching person', () => {
    expect(findLibrisPerson({ '@graph': [] }, 'fcrtpljz1qp2bdv')).toBeNull();
    expect(findLibrisPerson(undefined, 'fcrtpljz1qp2bdv')).toBeNull();
  });
});

describe('parseWikidataImageFile', () => {
  it('reads the first image statement', () => {
    const response = {
      entities: {
        Q55767: {
          claims: {
            P18: [{ mainsnak: { datavalue: { value: 'Astrid Lindgren (cropped).jpg' } } }, { mainsnak: { datavalue: { value: 'Other.jpg' } } }],
          },
        },
      },
    };

    expect(parseWikidataImageFile(response)).toBe('Astrid Lindgren (cropped).jpg');
  });

  it('returns null when the item has no usable image', () => {
    expect(parseWikidataImageFile({ entities: { Q1: { claims: {} } } })).toBeNull();
    expect(parseWikidataImageFile({ entities: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: 42 } } }] } } } })).toBeNull();
    expect(parseWikidataImageFile(null)).toBeNull();
  });
});
