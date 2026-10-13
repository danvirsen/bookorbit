import { MetadataCandidate, MetadataProviderKey, parseSeriesIndex } from '@bookorbit/types';

import { parsePublishedYear } from '../../../../common/utils/published-date.utils';
import { LibrisNode, LibrisRecordDocument, OneOrMany } from './libris.types';

export const LIBRIS_ORIGIN = 'https://libris.kb.se';

const AUTHOR_ROLE = 'https://id.kb.se/relator/author';
const NARRATOR_ROLES = new Set(['https://id.kb.se/relator/narrator', 'https://id.kb.se/relator/nrt']);
const GENRE_SCHEMES = /^https:\/\/id\.kb\.se\/term\/(?:barngf|saogf)\//;

// Libris codes languages as ISO 639-2; BookOrbit stores the two-letter code wherever one exists.
const LANGUAGE_CODES: Record<string, string> = {
  swe: 'sv',
  eng: 'en',
  nor: 'no',
  nob: 'nb',
  nno: 'nn',
  dan: 'da',
  fin: 'fi',
  ger: 'de',
  deu: 'de',
  fre: 'fr',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  ice: 'is',
  isl: 'is',
  smi: 'se',
};

// Libris XL ids are 15-16 lowercase alphanumerics. Numeric bib ids predate Libris XL and are
// resolved through the instance's sameAs link.
const XL_ID = /^[0-9a-z]{12,20}$/;
const BIB_ID = /^\d{1,10}$/;

export function asArray<T>(value: OneOrMany<T> | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstString(value: unknown): string | undefined {
  for (const item of asArray(value as OneOrMany<unknown>)) {
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return undefined;
}

function idOf(value: unknown): string | undefined {
  if (value && typeof value === 'object' && typeof (value as LibrisNode)['@id'] === 'string') return (value as LibrisNode)['@id'];
  return undefined;
}

export function extractLibrisId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const fromUrl = /libris\.kb\.se\/(?:katalogisering\/)?([0-9a-z]+)(?:[/#?]|$)/i.exec(trimmed);
  const candidate = (fromUrl ? fromUrl[1] : trimmed).toLowerCase();
  return XL_ID.test(candidate) && !BIB_ID.test(candidate) ? candidate : null;
}

export function extractLibrisBibId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const fromUrl = /libris\.kb\.se\/(?:resource\/)?bib\/(\d+)(?:[/#?]|$)/i.exec(trimmed);
  const candidate = fromUrl ? fromUrl[1] : trimmed;
  return BIB_ID.test(candidate) ? candidate : null;
}

export function librisRecordUrl(id: string): string {
  return `${LIBRIS_ORIGIN}/${encodeURIComponent(id)}`;
}

/** Indexes every node in the record, including the "card" subgraphs Libris embeds for linked entities. */
export function indexLibrisGraph(doc: LibrisRecordDocument): Map<string, LibrisNode> {
  const index = new Map<string, LibrisNode>();
  const visit = (nodes: LibrisNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) {
        visit(node['@graph']);
        continue;
      }
      const id = node['@id'];
      if (typeof id === 'string' && !index.has(id)) index.set(id, node);
    }
  };
  visit(doc['@graph']);
  return index;
}

function resolve(node: unknown, index: Map<string, LibrisNode>): LibrisNode | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const id = idOf(node);
  // A bare link carries only its @id; anything more is an inline entity that is already complete.
  if (id && Object.keys(node).length === 1) return index.get(id);
  return node as LibrisNode;
}

function cleanGivenName(value: string): string {
  // Older series records write "Rick." with a trailing full stop; initials such as "J.K." keep theirs.
  return /[a-zåäöéü]\.$/.test(value) ? value.slice(0, -1) : value;
}

function agentName(agent: LibrisNode | undefined): string | undefined {
  if (!agent) return undefined;
  const given = firstString(agent.givenName);
  const family = firstString(agent.familyName);
  if (given || family) return [given ? cleanGivenName(given) : undefined, family].filter(Boolean).join(' ');
  return firstString(agent.name) ?? firstString(agent.label);
}

function contributorNames(work: LibrisNode | undefined, index: Map<string, LibrisNode>): { authors: string[]; narrators: string[] } {
  const authors: string[] = [];
  const narrators: string[] = [];
  for (const contribution of asArray(work?.contribution as OneOrMany<LibrisNode>)) {
    const roles = asArray(contribution.role as OneOrMany<LibrisNode>)
      .map(idOf)
      .filter((r): r is string => !!r);
    const name = agentName(resolve(contribution.agent, index));
    if (!name) continue;
    const isPrimary = contribution['@type'] === 'PrimaryContribution';
    if (roles.includes(AUTHOR_ROLE) || (isPrimary && roles.length === 0)) {
      if (!authors.includes(name)) authors.push(name);
    } else if (roles.some((r) => NARRATOR_ROLES.has(r))) {
      if (!narrators.includes(name)) narrators.push(name);
    }
  }
  return { authors, narrators };
}

function cleanSummary(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*\[[^\]]{1,40}\]\s*$/, '') // trailing source tag such as "[Bokinfo]"
    .replace(/\s+/g, ' ')
    .trim();
}

function description(instance: LibrisNode, work: LibrisNode | undefined): string | undefined {
  for (const owner of [instance, work]) {
    for (const summary of asArray(owner?.summary as OneOrMany<LibrisNode>)) {
      const label = asArray(summary.label as OneOrMany<string>)
        .filter((l) => typeof l === 'string')
        .join(' ');
      const cleaned = cleanSummary(label);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

function title(instance: LibrisNode, work: LibrisNode | undefined): { title?: string; subtitle?: string } {
  for (const owner of [instance, work]) {
    const t =
      asArray(owner?.hasTitle as OneOrMany<LibrisNode>).find((h) => h['@type'] === 'Title') ?? asArray(owner?.hasTitle as OneOrMany<LibrisNode>)[0];
    const main = firstString(t?.mainTitle);
    if (main) return { title: main, subtitle: firstString(t?.subtitle) };
  }
  return {};
}

function publication(instance: LibrisNode): { publisher?: string; year?: number } {
  const pubs = asArray(instance.publication as OneOrMany<LibrisNode>);
  const pub = pubs.find((p) => p['@type'] === 'PrimaryPublication') ?? pubs[0];
  if (!pub) return {};
  const agent = pub.agent as LibrisNode | undefined;
  const publisher = agent ? (firstString(agent.label) ?? firstString(agent.name)) : undefined;
  const year = parsePublishedYear(firstString(pub.year) ?? firstString(pub.date)?.replace(/[^\d]/g, '').slice(0, 4));
  return { publisher: publisher?.replace(/[[\]]/g, '').trim() || undefined, year };
}

function extentLabels(instance: LibrisNode): string[] {
  return asArray(instance.extent as OneOrMany<LibrisNode>).flatMap((e) => asArray(e.label as OneOrMany<string>).filter((l) => typeof l === 'string'));
}

export function parsePageCount(labels: string[]): number | undefined {
  for (const label of labels) {
    const match = /(\d+)\s*(?:sidor|sid\.?|s\.|pages|p\.)/i.exec(label);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function parseDurationSeconds(labels: string[]): number | undefined {
  for (const label of labels) {
    const hours = /(\d+)\s*(?:tim|h\b)/i.exec(label);
    const minutes = /(\d+)\s*min/i.exec(label);
    if (hours || minutes) return (Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0)) * 60;
  }
  return undefined;
}

function isbns(instance: LibrisNode): { isbn10?: string; isbn13?: string } {
  let isbn10: string | undefined;
  let isbn13: string | undefined;
  for (const id of asArray(instance.identifiedBy as OneOrMany<LibrisNode>)) {
    if (id['@type'] !== 'ISBN') continue;
    const value = firstString(id.value)
      ?.replace(/[^\dXx]/g, '')
      .toUpperCase();
    if (!value) continue;
    if (value.length === 13 && !isbn13) isbn13 = value;
    else if (value.length === 10 && !isbn10) isbn10 = value;
  }
  return { isbn10, isbn13 };
}

export function parseSeriesEnumeration(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /(\d+(?:[.,]\d+)?)/.exec(value);
  return match ? (parseSeriesIndex(match[1].replace(',', '.')) ?? undefined) : undefined;
}

function series(instance: LibrisNode): { seriesName?: string; seriesIndex?: string } {
  for (const membership of asArray(instance.seriesMembership as OneOrMany<LibrisNode>)) {
    const name = firstString(membership.seriesStatement)?.replace(/\s*[;,:]\s*$/, '');
    if (name) return { seriesName: name, seriesIndex: parseSeriesEnumeration(firstString(membership.seriesEnumeration)) };
  }
  return {};
}

function genres(work: LibrisNode | undefined, index: Map<string, LibrisNode>): string[] {
  const labels: string[] = [];
  for (const category of asArray(work?.genreForm as OneOrMany<LibrisNode>).concat(asArray(work?.category as OneOrMany<LibrisNode>))) {
    const id = idOf(category);
    if (!id || !GENRE_SCHEMES.test(id)) continue;
    const node = index.get(id);
    const label = firstString(node?.prefLabel) ?? decodeURIComponent(id.slice(id.lastIndexOf('/') + 1));
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function language(work: LibrisNode | undefined, index: Map<string, LibrisNode>): string | undefined {
  const id = asArray(work?.language as OneOrMany<LibrisNode>)
    .map(idOf)
    .find(Boolean);
  if (!id) return undefined;
  const tag = firstString(index.get(id)?.langTag);
  if (tag) return tag;
  const code = id.slice(id.lastIndexOf('/') + 1);
  return LANGUAGE_CODES[code] ?? code;
}

function pixels(value: unknown): number | undefined {
  const match = /^(\d+)/.exec(firstString(value) ?? '');
  return match ? Number(match[1]) : undefined;
}

function cover(instance: LibrisNode, index: Map<string, LibrisNode>): { coverUrl?: string; coverWidth?: number; coverHeight?: number } {
  const image = asArray(instance.image as OneOrMany<LibrisNode>)[0];
  const url = idOf(image);
  if (!url) return {};
  const node = index.get(url);
  return { coverUrl: url, coverWidth: pixels(node?.width), coverHeight: pixels(node?.height) };
}

export function mapLibrisRecord(doc: LibrisRecordDocument, providerId: string): MetadataCandidate | null {
  const index = indexLibrisGraph(doc);
  const instance = index.get(`${LIBRIS_ORIGIN}/${providerId}#it`);
  if (!instance) return null;
  const work = resolve(instance.instanceOf, index);

  const { title: mainTitle, subtitle } = title(instance, work);
  if (!mainTitle) return null;
  const { authors, narrators } = contributorNames(work, index);
  const { publisher, year } = publication(instance);
  const extent = extentLabels(instance);
  const genreLabels = genres(work, index);

  return {
    provider: MetadataProviderKey.LIBRIS,
    providerId,
    title: mainTitle,
    subtitle,
    authors: authors.length ? authors : undefined,
    narrators: narrators.length ? narrators : undefined,
    description: description(instance, work),
    publisher,
    publishedYear: year,
    language: language(work, index),
    pageCount: parsePageCount(extent),
    durationSeconds: parseDurationSeconds(extent),
    ...isbns(instance),
    ...series(instance),
    genres: genreLabels.length ? genreLabels : undefined,
    ...cover(instance, index),
    sourceUrl: librisRecordUrl(providerId),
  };
}

export function extractLibrisFindIds(items: LibrisNode[] | undefined): string[] {
  const ids: string[] = [];
  for (const item of items ?? []) {
    const id = extractLibrisId(item['@id'] ?? '');
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
