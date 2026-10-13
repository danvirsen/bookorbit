import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { markProviderDegraded, markProviderFailed } from '../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../common/provider-cache/provider-cache-spec';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { pickSearchInputs, providerCacheContext, requestedMax } from '../provider-cache';
import { PROVIDER_LIMITS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { buildRequestSignal, normalizeMaxCandidates, rethrowWithPartialCandidates } from '../provider-utils';
import { extractLibrisBibId, extractLibrisFindIds, extractLibrisId, LIBRIS_ORIGIN, mapLibrisRecord } from './libris.mapper';
import { LibrisFindResponse, LibrisRecordDocument } from './libris.types';

const HEADERS: HeadersInit = { accept: 'application/ld+json, application/json;q=0.9' };

type FetchContext = { op: 'search' | 'lookup'; query?: string; providerId?: string };

function normalizeIsbn(isbn: string): string | null {
  const value = isbn.replace(/[^\dXx]/g, '').toUpperCase();
  return value.length === 10 || value.length === 13 ? value : null;
}

// Search results from find.jsonld only link people and genre terms, so each candidate is read from
// the record's own data.jsonld, which embeds them.
@Injectable()
export class LibrisProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.LIBRIS;
  readonly label = 'Libris';
  readonly identifiable = true as const;
  readonly coverShape = 'portrait' as const;
  readonly timeoutMs = PROVIDER_TIMEOUT_MS.SCRAPE;

  private readonly logger = new Logger(LibrisProvider.name);

  readonly cache: ProviderCacheSpec<MetadataSearchParams> = {
    version: 1,
    trustEmpty: true,
    authoritativeLookupStatuses: [404],
    context: async () => providerCacheContext((await this.providerConfig.getConfig()).libris.enabled),
    // An ISBN search falls back to title and author when Libris has no record for that ISBN.
    describeSearch: (params) => ({
      inputs: pickSearchInputs(params, ['isbn', 'title', 'author']),
      maxCandidates: requestedMax(params),
    }),
    describeLookup: (providerId) => ({ inputs: { id: providerId } }),
  };

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.libris);
    if (!enabled) return [];

    const limit = normalizeMaxCandidates(params.maxCandidatesPerProvider, PROVIDER_LIMITS.LIBRIS_MAX_RESULTS);
    let ids: string[] = [];
    const isbn = params.isbn ? normalizeIsbn(params.isbn) : null;
    if (isbn) ids = await this.findIds(this.buildIsbnFindUrl(isbn, limit), { op: 'search', query: `isbn:${isbn}` }, params.signal);
    if (ids.length === 0) {
      const query = [params.title, params.author]
        .map((v) => v?.trim())
        .filter(Boolean)
        .join(' ');
      if (query) ids = await this.findIds(this.buildTextFindUrl(query, limit), { op: 'search', query }, params.signal);
    }

    const results: MetadataCandidate[] = [];
    try {
      for (const id of ids.slice(0, limit)) {
        if (params.signal?.aborted) {
          markProviderDegraded('libris.search: aborted before every record loaded');
          break;
        }
        const candidate = await this.fetchRecord(id, params.signal);
        if (candidate) results.push(candidate);
        else markProviderDegraded('libris.search: record skipped');
      }
    } catch (err) {
      rethrowWithPartialCandidates(err, results);
    }
    return results;
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.libris);
    if (!enabled) return null;
    const id = extractLibrisId(providerId) ?? (await this.resolveBibId(providerId, signal));
    if (!id) return null;
    return this.fetchRecord(id, signal);
  }

  private async resolveBibId(providerId: string, signal?: AbortSignal): Promise<string | null> {
    const bibId = extractLibrisBibId(providerId);
    if (!bibId) return null;
    const params = new URLSearchParams({ q: '*', 'sameAs.@id': `http://libris.kb.se/resource/bib/${bibId}`, _limit: '1' });
    const ids = await this.findIds(`${LIBRIS_ORIGIN}/find.jsonld?${params.toString()}`, { op: 'lookup', providerId: bibId }, signal);
    return ids[0] ?? null;
  }

  private buildIsbnFindUrl(isbn: string, limit: number): string {
    const params = new URLSearchParams({ q: '*', 'identifiedBy.value': isbn, '@type': 'Instance', _limit: String(limit) });
    return `${LIBRIS_ORIGIN}/find.jsonld?${params.toString()}`;
  }

  private buildTextFindUrl(query: string, limit: number): string {
    const params = new URLSearchParams({ q: query, '@type': 'Instance', _limit: String(limit) });
    return `${LIBRIS_ORIGIN}/find.jsonld?${params.toString()}`;
  }

  private async findIds(url: string, context: FetchContext, signal?: AbortSignal): Promise<string[]> {
    const body = await this.fetchJson<LibrisFindResponse>(url, context, signal);
    if (!body) return [];
    if (!Array.isArray(body.items) && typeof body.totalItems !== 'number') {
      markProviderFailed(`libris.${context.op}: response without results`);
      return [];
    }
    return extractLibrisFindIds(body.items);
  }

  private async fetchRecord(id: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const doc = await this.fetchJson<LibrisRecordDocument>(
      `${LIBRIS_ORIGIN}/${encodeURIComponent(id)}/data.jsonld`,
      { op: 'lookup', providerId: id },
      signal,
    );
    if (!doc) return null;
    const candidate = mapLibrisRecord(doc, id);
    if (!candidate) markProviderDegraded('libris.lookup: record did not parse');
    return candidate;
  }

  private async fetchJson<T>(url: string, context: FetchContext, signal?: AbortSignal): Promise<T | null> {
    const startedAt = Date.now();
    const safeQuery = context.query ? ` query="${sanitizeLogValue(context.query)}"` : '';
    const safeId = context.providerId ? ` providerId="${sanitizeLogValue(context.providerId)}"` : '';
    const subject = `${safeId}${safeQuery}`;
    this.logger.log(`[libris] [start] op=${context.op}${subject} - libris fetch started`);

    try {
      const res = await fetchWithThrottle(url, { headers: HEADERS, signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal) });
      if (res.status === 404) {
        this.logger.log(
          `[libris] [end] op=${context.op}${subject} status=404 durationMs=${Date.now() - startedAt} found=false - libris fetch completed`,
        );
        return null;
      }
      if (!res.ok) {
        markProviderFailed(`libris.${context.op}: http ${res.status}`);
        this.logger.warn(
          `[libris] [fail] op=${context.op}${subject} status=${res.status} durationMs=${Date.now() - startedAt} errorClass=HttpError error="non-ok response" - libris fetch failed`,
        );
        return null;
      }
      const body = (await res.json()) as T;
      this.logger.log(`[libris] [end] op=${context.op}${subject} status=${res.status} durationMs=${Date.now() - startedAt} - libris fetch completed`);
      return body;
    } catch (error) {
      if (error instanceof ProviderThrottleError) {
        this.logger.warn(
          `[libris] [fail] op=${context.op}${subject} durationMs=${Date.now() - startedAt} errorClass=ProviderThrottleError error="throttled" - libris fetch throttled`,
        );
        throw error;
      }
      markProviderFailed(`libris.${context.op}: request failed`);
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[libris] [fail] op=${context.op}${subject} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - libris fetch failed`,
      );
      return null;
    }
  }
}
