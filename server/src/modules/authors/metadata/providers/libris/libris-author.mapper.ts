import { LibrisPersonNode, LibrisPersonRecord, OneOrMany, ParsedLibrisAuthor, WikidataEntityResponse } from './libris.types';

// Libris XL ids are 15-16 lowercase alphanumerics. Purely numeric ids are
// pre-XL authority numbers, which the record endpoint does not resolve.
const XL_ID_RE = /^[0-9a-z]{12,20}$/;
const NUMERIC_ID_RE = /^\d+$/;
const RECORD_URL_RE = /libris\.kb\.se\/(?:katalogisering\/)?([0-9a-z]+)(?:[/#?]|$)/i;
const LIFE_SPAN_RE = /^(\d{3,4})?\s*-\s*(\d{3,4})?$/;
const WIKIDATA_ENTITY_RE = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/;

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function asArray<T>(value: OneOrMany<T> | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function strings(value: OneOrMany<string> | undefined): string[] {
  return asArray(value)
    .filter((item): item is string => typeof item === 'string')
    .map(squash)
    .filter(Boolean);
}

function personName(node: LibrisPersonNode): string {
  const fullName = [strings(node.givenName)[0], strings(node.familyName)[0]].filter(Boolean).join(' ');
  return fullName || (strings(node.name)[0] ?? '');
}

export function extractLibrisAuthorId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const candidate = (RECORD_URL_RE.exec(trimmed)?.[1] ?? trimmed).toLowerCase();
  return XL_ID_RE.test(candidate) && !NUMERIC_ID_RE.test(candidate) ? candidate : null;
}

// A living person's span is open-ended ("1934-"), and some records carry only
// a death year ("-1650").
export function parseLibrisLifeSpan(value: OneOrMany<string> | undefined): Pick<ParsedLibrisAuthor, 'birthYear' | 'deathYear'> {
  const match = LIFE_SPAN_RE.exec(strings(value)[0] ?? '');
  if (!match) return {};
  return {
    birthYear: match[1] ? Number(match[1]) : undefined,
    deathYear: match[2] ? Number(match[2]) : undefined,
  };
}

// Libris links a photo only when it has copied one from Wikidata, so a person
// without one is not worth the extra Wikidata request.
function photoWikidataId(node: LibrisPersonNode): string | undefined {
  if (asArray(node.image).length === 0) return undefined;
  for (const link of asArray(node.exactMatch)) {
    const match = WIKIDATA_ENTITY_RE.exec(link?.['@id'] ?? '');
    if (match) return match[1];
  }
  return undefined;
}

export function parseLibrisPerson(node: LibrisPersonNode | null | undefined): ParsedLibrisAuthor | null {
  if (node?.['@type'] !== 'Person') return null;

  const providerId = extractLibrisAuthorId(node['@id']);
  const name = personName(node);
  if (!providerId || !name) return null;

  return {
    providerId,
    name,
    description: strings(node.description).join(' ') || undefined,
    ...parseLibrisLifeSpan(node.lifeSpan),
    wikidataId: photoWikidataId(node),
  };
}

// A record's graph holds the person next to "card" subgraphs for everything it
// links to, so the person is picked by its own id rather than by position.
export function findLibrisPerson(record: LibrisPersonRecord | null | undefined, providerId: string): LibrisPersonNode | null {
  return record?.['@graph']?.find((node) => node?.['@type'] === 'Person' && extractLibrisAuthorId(node['@id']) === providerId) ?? null;
}

export function parseWikidataImageFile(response: WikidataEntityResponse | null | undefined): string | null {
  for (const entity of Object.values(response?.entities ?? {})) {
    const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (typeof file === 'string' && file.trim()) return file.trim();
  }
  return null;
}
