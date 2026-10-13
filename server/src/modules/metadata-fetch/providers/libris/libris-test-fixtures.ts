import type { LibrisRecordDocument } from './libris.types';

/** Trimmed copy of https://libris.kb.se/ctv82fx49rndh4z7/data.jsonld (Titanens förbannelse, 2023). */
export const TITANENS_RECORD: LibrisRecordDocument = {
  '@graph': [
    { '@id': 'https://libris.kb.se/ctv82fx49rndh4z7', '@type': 'Record', mainEntity: { '@id': 'https://libris.kb.se/ctv82fx49rndh4z7#it' } },
    {
      '@id': 'https://libris.kb.se/ctv82fx49rndh4z7#it',
      '@type': 'PhysicalResource',
      image: [{ '@id': 'https://libris.kb.se/dataset/images/dbd904b86cdf44d81eda3fa68ab23c64.full.jpg' }],
      extent: [{ '@type': 'Extent', label: ['366 sidor'] }],
      summary: [
        {
          '@type': 'Summary',
          label: [
            'Halvguden Percy Jackson får ett nödanrop från sin gode vän Grover.\u200B\u200B ”Titanens förbannelse” är den tredje boken om Percy Jackson.[Bokinfo]',
          ],
        },
      ],
      hasTitle: [{ '@type': 'Title', mainTitle: 'Titanens förbannelse' }],
      instanceOf: { '@id': 'https://libris.kb.se/0hr5wfwkxc06kvmx#it' },
      publication: [
        {
          '@type': 'PrimaryPublication',
          date: ['[2023]'],
          year: '2023',
          agent: { '@type': 'Agent', label: ['Bonnier Carlsen'] },
          place: [{ '@type': 'Place', label: ['[Stockholm]'] }],
        },
      ],
      identifiedBy: [{ '@type': 'ISBN', value: '9789179793098', qualifier: ['danskt band'] }],
      seriesMembership: [{ '@type': 'SeriesMembership', seriesStatement: ['Percy Jackson'], seriesEnumeration: '3:e boken' }],
      responsibilityStatement: 'Rick Riordan ; översättning av Torun Lidfeldt Bager',
    },
    {
      '@id': 'https://libris.kb.se/0hr5wfwkxc06kvmx?lens=card',
      '@graph': [
        { '@id': 'https://libris.kb.se/0hr5wfwkxc06kvmx', '@type': 'Record' },
        {
          '@id': 'https://libris.kb.se/0hr5wfwkxc06kvmx#it',
          '@type': 'Monograph',
          subject: [{ '@id': 'https://id.kb.se/term/barn/Grekisk%20mytologi' }],
          category: [
            { '@id': 'https://id.kb.se/term/barngf/Ungdomsb%C3%B6cker' },
            { '@id': 'https://id.kb.se/term/barngf/Fantasy' },
            { '@id': 'https://id.kb.se/term/rda/Text' },
          ],
          language: [{ '@id': 'https://id.kb.se/language/swe' }],
          contribution: [
            {
              '@type': 'PrimaryContribution',
              role: { '@id': 'https://id.kb.se/relator/author' },
              agent: { '@id': 'https://libris.kb.se/vs69jlfd3srj704#it' },
            },
            {
              '@type': 'Contribution',
              role: [{ '@id': 'https://id.kb.se/relator/translator' }],
              agent: { '@id': 'https://libris.kb.se/c9prvzmw1v4t7vc#it' },
            },
          ],
        },
      ],
    },
    {
      '@id': 'https://libris.kb.se/20dgklkl5g12hwx?lens=card',
      '@graph': [{ '@id': 'https://id.kb.se/term/barngf/Ungdomsb%C3%B6cker', '@type': 'GenreForm', prefLabel: 'Ungdomsböcker' }],
    },
    {
      '@id': 'https://libris.kb.se/93lzl5lfc2l3hvc7?lens=card',
      '@graph': [{ '@id': 'https://id.kb.se/language/swe', '@type': 'Language', code: 'swe', langTag: 'sv' }],
    },
    {
      '@id': 'https://libris.kb.se/6qc276sg458d21h1?lens=card',
      '@graph': [
        {
          '@id': 'https://libris.kb.se/dataset/images/dbd904b86cdf44d81eda3fa68ab23c64.full.jpg',
          '@type': 'ImageObject',
          width: '1400px',
          height: '2178px',
        },
      ],
    },
    {
      '@id': 'https://libris.kb.se/vs69jlfd3srj704?lens=card',
      '@graph': [{ '@id': 'https://libris.kb.se/vs69jlfd3srj704#it', '@type': 'Person', givenName: 'Rick', familyName: 'Riordan' }],
    },
    {
      '@id': 'https://libris.kb.se/c9prvzmw1v4t7vc?lens=card',
      '@graph': [{ '@id': 'https://libris.kb.se/c9prvzmw1v4t7vc#it', '@type': 'Person', givenName: 'Torun', familyName: 'Reuterswärd' }],
    },
  ],
};

/** An audiobook with an inline local work, a narrator and an extent in hours and minutes. */
export const AUDIOBOOK_RECORD: LibrisRecordDocument = {
  '@graph': [
    { '@id': 'https://libris.kb.se/abcd1234efgh5678', '@type': 'Record' },
    {
      '@id': 'https://libris.kb.se/abcd1234efgh5678#it',
      '@type': 'Electronic',
      extent: [{ '@type': 'Extent', label: '1 ljudfil (MP3) (8 tim., 12 min.)' }],
      hasTitle: { '@type': 'Title', mainTitle: 'Bröderna Lejonhjärta', subtitle: 'ljudbok' },
      instanceOf: {
        '@type': 'Text',
        language: { '@id': 'https://id.kb.se/language/swe' },
        genreForm: [{ '@id': 'https://id.kb.se/term/saogf/Fantasy' }],
        contribution: [
          { '@type': 'PrimaryContribution', agent: { '@type': 'Person', givenName: 'Astrid', familyName: 'Lindgren' } },
          {
            '@type': 'Contribution',
            role: { '@id': 'https://id.kb.se/relator/narrator' },
            agent: { '@type': 'Person', givenName: 'Astrid', familyName: 'Lindgren' },
          },
        ],
      },
      publication: { '@type': 'PrimaryPublication', date: '2019' },
      identifiedBy: [
        { '@type': 'ISBN', value: '91-29-65730-5' },
        { '@type': 'ISBN', value: '978-91-29-72389-1' },
      ],
      seriesMembership: [],
    },
  ],
};

export const FIND_RESPONSE = {
  totalItems: 2,
  items: [
    { '@type': 'PhysicalResource', '@id': 'https://libris.kb.se/ctv82fx49rndh4z7#it' },
    { '@type': 'PhysicalResource', '@id': 'https://libris.kb.se/zfgvn1jbwhv3mq9m#it' },
  ],
};
