import { Injectable, Logger } from '@nestjs/common';
import { AUTHOR_PROVIDER_SUPPORTED_FIELDS, AuthorMetadataCandidate, AuthorMetadataField, AuthorMetadataProviderKey } from '@bookorbit/types';

import { canonicalId, canonicalText } from '../../../../../common/provider-cache/canonicalize';
import { markProviderDegraded, markProviderFailed } from '../../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../../common/provider-cache/provider-cache-spec';
import { sanitizeLogValue } from '../../../../../common/utils/log-sanitize.utils';
import { ProviderConfigService } from '../../../../metadata-preferences/provider-config.service';
import { authorProviderFetch, authorRequestSignal } from '../author-fetch';
import { AuthorMetadataProviderError, AuthorMetadataSearchParams, IdentifiableAuthorMetadataProvider } from '../author-metadata-provider';
import { authorProviderCacheContext } from '../author-provider-cache';
import { extractLibrisAuthorId, findLibrisPerson, parseLibrisPerson, parseWikidataImageFile } from './libris-author.mapper';
import { LibrisPersonRecord, LibrisPersonSearchResponse, ParsedLibrisAuthor, WikidataEntityResponse } from './libris.types';

const BASE_URL = 'https://libris.kb.se';
const WIKIDATA_URL = 'https://www.wikidata.org/wiki/Special:EntityData';
const COMMONS_FILE_URL = 'https://commons.wikimedia.org/wiki/Special:FilePath';
const PHOTO_WIDTH_PX = 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const JSON_HEADERS: HeadersInit = {
  accept: 'application/ld+json, application/json;q=0.9',
};

// Wikimedia blocks generic clients and asks for an agent that names the tool.
const WIKIDATA_HEADERS: HeadersInit = {
  'user-agent': 'BookOrbit/1.0 (+https://bookorbit.app)',
  accept: 'application/json',
};

type FetchOp = 'search' | 'lookup' | 'photo';

@Injectable()
export class LibrisAuthorMetadataProvider implements IdentifiableAuthorMetadataProvider {
  readonly key = AuthorMetadataProviderKey.LIBRIS;
  readonly label = 'Libris';
  readonly identifiable = true as const;
  readonly supportedFields: readonly AuthorMetadataField[] = AUTHOR_PROVIDER_SUPPORTED_FIELDS[AuthorMetadataProviderKey.LIBRIS];

  private readonly logger = new Logger(LibrisAuthorMetadataProvider.name);

  // Empty answers are trusted because every way Libris can fail (transport, status, malformed body)
  // leaves the call record uncacheable. A 404 lookup is Libris saying the id does not exist.
  readonly cache: ProviderCacheSpec<AuthorMetadataSearchParams> = {
    version: 1,
    trustEmpty: true,
    authoritativeLookupStatuses: [404],
    context: async () => authorProviderCacheContext(await this.isEnabled()),
    describeSearch: (params) => {
      const name = canonicalText(params.name);
      if (!name) return null;
      return { inputs: { name }, maxCandidates: this.normalizeLimit(params.limit) };
    },
    describeLookup: (providerId) => {
      const id = canonicalId(providerId);
      return id ? { inputs: { id } } : null;
    },
  };

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]> {
    if (!(await this.isEnabled())) return [];

    const name = params.name?.trim();
    if (!name) return [];

    const limit = this.normalizeLimit(params.limit);
    const query = new URLSearchParams({ q: name, '@type': 'Person', _limit: String(limit) }).toString();
    const body = await this.fetchJson<LibrisPersonSearchResponse>(`${BASE_URL}/find.jsonld?${query}`, 'search', JSON_HEADERS, params.signal);
    if (!Array.isArray(body?.items)) {
      markProviderFailed('libris_unexpected_search_body');
      return [];
    }

    const seenProviderIds = new Set<string>();
    const candidates: AuthorMetadataCandidate[] = [];

    for (const item of body.items) {
      const parsed = parseLibrisPerson(item);
      if (!parsed) {
        markProviderDegraded('libris_unmapped_person');
        continue;
      }
      if (seenProviderIds.has(parsed.providerId)) continue;
      seenProviderIds.add(parsed.providerId);
      candidates.push(this.toCandidate(parsed));
      if (candidates.length >= limit) break;
    }

    return candidates;
  }

  async lookupById(providerId: string, _region?: string, signal?: AbortSignal): Promise<AuthorMetadataCandidate | null> {
    if (!(await this.isEnabled())) return null;

    const id = extractLibrisAuthorId(providerId);
    if (!id) return null;

    const record = await this.fetchJson<LibrisPersonRecord>(`${BASE_URL}/${encodeURIComponent(id)}/data.jsonld`, 'lookup', JSON_HEADERS, signal);
    if (!record) return null;

    const parsed = parseLibrisPerson(findLibrisPerson(record, id));
    if (!parsed) {
      markProviderDegraded('libris_unmapped_person');
      return null;
    }
    const imageUrl = parsed.wikidataId ? await this.fetchPhotoUrl(parsed.wikidataId, signal) : undefined;
    return this.toCandidate(parsed, imageUrl);
  }

  // A photo is a bonus on top of the Libris record, so losing Wikidata costs the
  // photo rather than the whole lookup. The failed request still keeps the
  // answer out of the cache.
  private async fetchPhotoUrl(wikidataId: string, signal?: AbortSignal): Promise<string | undefined> {
    let entity: WikidataEntityResponse | null;
    try {
      entity = await this.fetchJson<WikidataEntityResponse>(
        `${WIKIDATA_URL}/${encodeURIComponent(wikidataId)}.json`,
        'photo',
        WIKIDATA_HEADERS,
        signal,
      );
    } catch {
      markProviderDegraded('libris_wikidata_photo_failed');
      return undefined;
    }
    const file = parseWikidataImageFile(entity);
    if (!file) {
      markProviderDegraded('libris_wikidata_photo_missing');
      return undefined;
    }
    return `${COMMONS_FILE_URL}/${encodeURIComponent(file)}?width=${PHOTO_WIDTH_PX}`;
  }

  private toCandidate(parsed: ParsedLibrisAuthor, imageUrl?: string): AuthorMetadataCandidate {
    return {
      provider: this.key,
      providerId: parsed.providerId,
      name: parsed.name,
      description: parsed.description,
      imageUrl,
      sourceUrl: `${BASE_URL}/${parsed.providerId}`,
      birthYear: parsed.birthYear,
      deathYear: parsed.deathYear,
    };
  }

  private async isEnabled(): Promise<boolean> {
    const config = await this.providerConfig.getConfig();
    return config.libris.enabled;
  }

  /** Resolves to null only for a 404, which both Libris and Wikidata answer for an id they do not know. */
  private async fetchJson<T>(url: string, op: FetchOp, headers: HeadersInit, signal?: AbortSignal): Promise<T | null> {
    const startedAt = Date.now();
    this.logger.log(`[libris_author] [start] op=${op} method=GET`);
    try {
      const res = await authorProviderFetch(url, { headers, signal: authorRequestSignal(REQUEST_TIMEOUT_MS, signal) });
      if (res.status === 404) {
        this.logger.log(`[libris_author] [end] op=${op} method=GET status=404 durationMs=${Date.now() - startedAt} found=false`);
        return null;
      }
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        const message = `[libris_author] [fail] op=${op} method=GET status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`;
        this.logger.warn(message);
        throw new AuthorMetadataProviderError(message, {
          httpStatus: res.status,
          retryAfterMs,
          transient: res.status === 429 || res.status >= 500,
        });
      }
      let body: T;
      try {
        body = (await res.json()) as T;
      } catch (error) {
        markProviderFailed('libris_malformed_json');
        throw error;
      }
      this.logger.log(`[libris_author] [end] op=${op} method=GET status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (error) {
      if (error instanceof AuthorMetadataProviderError) throw error;
      const rawMessage = error instanceof Error ? error.message : 'unknown error';
      const message = `[libris_author] [fail] op=${op} method=GET durationMs=${Date.now() - startedAt} error="${sanitizeLogValue(rawMessage)}"`;
      this.logger.warn(message);
      throw new AuthorMetadataProviderError(message, { transient: true });
    }
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
    return Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit))));
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const dateMs = new Date(value).getTime();
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : null;
}
