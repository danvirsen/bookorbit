import { AuthorMetadataProviderKey } from '@bookorbit/types';

import { ProviderCallRecord, runWithProviderCallRecord } from '../../../../../common/provider-cache/provider-call-context';
import { ProviderConfigService } from '../../../../metadata-preferences/provider-config.service';
import { AuthorMetadataProviderError } from '../author-metadata-provider';
import { LibrisAuthorMetadataProvider } from './libris.provider';

function configService(enabled: boolean): ProviderConfigService {
  return { getConfig: vi.fn().mockResolvedValue({ libris: { enabled } }) } as unknown as ProviderConfigService;
}

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; retryAfter?: string }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue(init?.retryAfter ?? null) },
  };
}

const LINDGREN = {
  '@id': 'https://libris.kb.se/fcrtpljz1qp2bdv#it',
  '@type': 'Person',
  givenName: 'Astrid',
  familyName: 'Lindgren',
  lifeSpan: '1907-2002',
  description: ['Skönlitterär författare av barn- och ungdomsböcker.'],
};

const NYMAN = {
  '@id': 'https://libris.kb.se/mkz12m550b8sztn#it',
  '@type': 'Person',
  givenName: 'Karin',
  familyName: 'Nyman',
  lifeSpan: '1934-',
};

const LINDGREN_RECORD = {
  '@graph': [
    { '@id': 'https://libris.kb.se/fcrtpljz1qp2bdv', '@type': 'Record' },
    LINDGREN,
    { '@id': 'https://libris.kb.se/mkz12m550b8sztn?lens=card', '@graph': [NYMAN] },
  ],
};

const LINDGREN_WITH_PHOTO = {
  ...LINDGREN,
  image: [{ '@id': 'https://libris.kb.se/dataset/images/d4dd60f76e1dfbe1a327cb06f1a1cee3.full.jpg' }],
  exactMatch: [{ '@id': 'http://www.wikidata.org/entity/Q55767' }],
};

const LINDGREN_WIKIDATA = {
  entities: { Q55767: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Astrid Lindgren (cropped).jpg' } } }] } } },
};

describe('LibrisAuthorMetadataProvider', () => {
  let provider: LibrisAuthorMetadataProvider;

  beforeEach(() => {
    provider = new LibrisAuthorMetadataProvider(configService(true));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps every person in a search answer without loading their records', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ totalItems: 2, items: [LINDGREN, NYMAN] }));

    const results = await provider.search({ name: 'Astrid Lindgren' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('https://libris.kb.se/find.jsonld?q=Astrid+Lindgren&%40type=Person&_limit=10', expect.any(Object));
    expect(results).toEqual([
      {
        provider: AuthorMetadataProviderKey.LIBRIS,
        providerId: 'fcrtpljz1qp2bdv',
        name: 'Astrid Lindgren',
        description: 'Skönlitterär författare av barn- och ungdomsböcker.',
        sourceUrl: 'https://libris.kb.se/fcrtpljz1qp2bdv',
        birthYear: 1907,
        deathYear: 2002,
      },
      {
        provider: AuthorMetadataProviderKey.LIBRIS,
        providerId: 'mkz12m550b8sztn',
        name: 'Karin Nyman',
        description: undefined,
        sourceUrl: 'https://libris.kb.se/mkz12m550b8sztn',
        birthYear: 1934,
        deathYear: undefined,
      },
    ]);
  });

  it('drops a person that appears twice in one answer', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ items: [LINDGREN, LINDGREN] }));

    expect(await provider.search({ name: 'Astrid Lindgren' })).toHaveLength(1);
  });

  it('lookupById reads the person out of its record graph', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(LINDGREN_RECORD));

    const candidate = await provider.lookupById('https://libris.kb.se/fcrtpljz1qp2bdv');

    expect(global.fetch).toHaveBeenCalledWith('https://libris.kb.se/fcrtpljz1qp2bdv/data.jsonld', expect.any(Object));
    expect(candidate).toMatchObject({
      provider: AuthorMetadataProviderKey.LIBRIS,
      providerId: 'fcrtpljz1qp2bdv',
      name: 'Astrid Lindgren',
      birthYear: 1907,
      deathYear: 2002,
      sourceUrl: 'https://libris.kb.se/fcrtpljz1qp2bdv',
    });
  });

  it('lookupById takes the photo from the Wikidata item Libris links to', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ '@graph': [LINDGREN_WITH_PHOTO] }))
      .mockResolvedValueOnce(jsonResponse(LINDGREN_WIKIDATA));

    const candidate = await provider.lookupById('fcrtpljz1qp2bdv');

    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://www.wikidata.org/wiki/Special:EntityData/Q55767.json',
      expect.objectContaining({ headers: expect.objectContaining({ 'user-agent': expect.stringContaining('BookOrbit') }) }),
    );
    expect(candidate?.imageUrl).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Astrid%20Lindgren%20(cropped).jpg?width=1000');
  });

  it('skips Wikidata for a person Libris has no photo for', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ '@graph': [{ ...LINDGREN_WITH_PHOTO, image: undefined }] }));

    const candidate = await provider.lookupById('fcrtpljz1qp2bdv');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(candidate?.imageUrl).toBeUndefined();
  });

  it('keeps the rest of the lookup when Wikidata fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ '@graph': [LINDGREN_WITH_PHOTO] }))
      .mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 429 }));

    const candidate = await provider.lookupById('fcrtpljz1qp2bdv');

    expect(candidate).toMatchObject({ providerId: 'fcrtpljz1qp2bdv', name: 'Astrid Lindgren', birthYear: 1907 });
    expect(candidate?.imageUrl).toBeUndefined();
  });

  it('leaves photos to lookups so a search makes a single request', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ items: [LINDGREN_WITH_PHOTO] }));

    const [candidate] = await provider.search({ name: 'Astrid Lindgren' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(candidate.imageUrl).toBeUndefined();
  });

  it('returns null for an id Libris does not know', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(null, { ok: false, status: 404 }));

    expect(await provider.lookupById('fcrtpljz1qp2bdv')).toBeNull();
  });

  it('skips the request for an id that is not a Libris XL id', async () => {
    global.fetch = vi.fn();

    expect(await provider.lookupById('71639')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a rate limit as a transient error carrying retryAfterMs', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(null, { ok: false, status: 429, retryAfter: '30' }));

    await expect(provider.lookupById('fcrtpljz1qp2bdv')).rejects.toMatchObject({
      httpStatus: 429,
      retryAfterMs: 30_000,
      transient: true,
    });
    await expect(provider.lookupById('fcrtpljz1qp2bdv')).rejects.toBeInstanceOf(AuthorMetadataProviderError);
  });

  it('surfaces a network failure as a transient error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(provider.search({ name: 'Astrid Lindgren' })).rejects.toMatchObject({ httpStatus: null, transient: true });
  });

  it('does no network work while the provider is disabled', async () => {
    const disabled = new LibrisAuthorMetadataProvider(configService(false));
    global.fetch = vi.fn();

    expect(await disabled.search({ name: 'Astrid Lindgren' })).toEqual([]);
    expect(await disabled.lookupById('fcrtpljz1qp2bdv')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores a blank name without calling out', async () => {
    global.fetch = vi.fn();

    expect(await provider.search({ name: '   ' })).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('passes the caller deadline into every request', async () => {
    const controller = new AbortController();
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(LINDGREN_RECORD));

    await provider.lookupById('fcrtpljz1qp2bdv', undefined, controller.signal);
    const signal = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  describe('cache hardening markers', () => {
    async function recorded<T>(run: () => Promise<T>): Promise<{ value: T; record: ProviderCallRecord }> {
      const record = new ProviderCallRecord();
      const value = await runWithProviderCallRecord(record, run);
      return { value, record };
    }

    it('leaves a clean record for a well-formed search answer', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ totalItems: 1, items: [LINDGREN] }));

      const { record } = await recorded(() => provider.search({ name: 'Astrid Lindgren' }));

      expect(record.mainRequests).toBe(1);
      expect(record.unsuccessfulRequests()).toEqual([]);
      expect(record.failureReasons).toEqual([]);
      expect(record.degradationReasons).toEqual([]);
    });

    it('leaves a clean record for a search with no matches', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ totalItems: 0, items: [] }));

      const { value, record } = await recorded(() => provider.search({ name: 'Nobody At All' }));

      expect(value).toEqual([]);
      expect(record.failureReasons).toEqual([]);
    });

    it('marks a search answer without items as failed', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'oops' }));

      const { value, record } = await recorded(() => provider.search({ name: 'Astrid Lindgren' }));

      expect(value).toEqual([]);
      expect(record.failureReasons).toContain('libris_unexpected_search_body');
    });

    it('marks malformed JSON as failed', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ...jsonResponse(null), json: vi.fn().mockRejectedValue(new SyntaxError('bad json')) });

      const record = new ProviderCallRecord();
      await expect(runWithProviderCallRecord(record, () => provider.search({ name: 'Astrid Lindgren' }))).rejects.toBeInstanceOf(
        AuthorMetadataProviderError,
      );

      expect(record.failureReasons).toContain('libris_malformed_json');
    });

    it('marks a person that cannot be mapped as degraded and keeps the rest', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ items: [{ '@type': 'Person' }, LINDGREN] }));

      const { value, record } = await recorded(() => provider.search({ name: 'Astrid Lindgren' }));

      expect(value).toEqual([expect.objectContaining({ providerId: 'fcrtpljz1qp2bdv' })]);
      expect(record.degradationReasons).toContain('libris_unmapped_person');
    });

    it('marks a record without the person as degraded', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ '@graph': [{ '@id': 'https://libris.kb.se/fcrtpljz1qp2bdv', '@type': 'Record' }] }));

      const { value, record } = await recorded(() => provider.lookupById('fcrtpljz1qp2bdv'));

      expect(value).toBeNull();
      expect(record.degradationReasons).toContain('libris_unmapped_person');
    });

    it('marks a failed Wikidata request as degraded and keeps it from the cache', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ '@graph': [LINDGREN_WITH_PHOTO] }))
        .mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 503 }));

      const { value, record } = await recorded(() => provider.lookupById('fcrtpljz1qp2bdv'));

      expect(value).toMatchObject({ providerId: 'fcrtpljz1qp2bdv' });
      expect(record.degradationReasons).toContain('libris_wikidata_photo_failed');
      expect(record.unsuccessfulRequests()).toEqual([{ kind: 'status', status: 503 }]);
    });

    it('marks a Wikidata item without a photo as degraded', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ '@graph': [LINDGREN_WITH_PHOTO] }))
        .mockResolvedValueOnce(jsonResponse({ entities: { Q55767: { claims: {} } } }));

      const { value, record } = await recorded(() => provider.lookupById('fcrtpljz1qp2bdv'));

      expect(value?.imageUrl).toBeUndefined();
      expect(record.degradationReasons).toContain('libris_wikidata_photo_missing');
    });

    it('records a failed status as an unsuccessful request', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(null, { ok: false, status: 503 }));

      const record = new ProviderCallRecord();
      await expect(runWithProviderCallRecord(record, () => provider.lookupById('fcrtpljz1qp2bdv'))).rejects.toBeInstanceOf(
        AuthorMetadataProviderError,
      );

      expect(record.unsuccessfulRequests()).toEqual([{ kind: 'status', status: 503 }]);
    });
  });

  describe('cache declaration', () => {
    it('keeps empty answers and treats a 404 lookup as an answer', () => {
      expect(provider.cache.version).toBe(1);
      expect(provider.cache.trustEmpty).toBe(true);
      expect(provider.cache.authoritativeLookupStatuses).toEqual([404]);
    });

    it('is available only while the provider is enabled', async () => {
      await expect(provider.cache.context()).resolves.toEqual({ available: true, fingerprint: '{}' });
      await expect(new LibrisAuthorMetadataProvider(configService(false)).cache.context()).resolves.toEqual({
        available: false,
        fingerprint: '{}',
      });
    });

    it('keys a search by the canonical name and the result cap it honours', () => {
      expect(provider.cache.describeSearch({ name: '  Astrid   Lindgren ' })).toEqual({ inputs: { name: 'Astrid Lindgren' }, maxCandidates: 10 });
      expect(provider.cache.describeSearch({ name: 'Astrid Lindgren', limit: 3 })).toEqual({
        inputs: { name: 'Astrid Lindgren' },
        maxCandidates: 3,
      });
      expect(provider.cache.describeSearch({ name: 'Astrid Lindgren', limit: 400 })).toEqual({
        inputs: { name: 'Astrid Lindgren' },
        maxCandidates: 25,
      });
      expect(provider.cache.describeSearch({ name: '   ' })).toBeNull();
    });

    it('ignores inputs that do not change the request', () => {
      const base = provider.cache.describeSearch({ name: 'Astrid Lindgren', limit: 5 });

      expect(provider.cache.describeSearch({ name: 'Astrid Lindgren', limit: 5, region: 'uk', signal: new AbortController().signal })).toEqual(base);
      expect(provider.cache.describeLookup('fcrtpljz1qp2bdv', { name: 'x', region: 'ca' })).toEqual(
        provider.cache.describeLookup(' fcrtpljz1qp2bdv '),
      );
    });

    it('keys a lookup by the provider id', () => {
      expect(provider.cache.describeLookup(' fcrtpljz1qp2bdv ')).toEqual({ inputs: { id: 'fcrtpljz1qp2bdv' } });
      expect(provider.cache.describeLookup('  ')).toBeNull();
    });

    it('honours the result cap it declares', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ items: [LINDGREN, NYMAN] }));

      await expect(provider.search({ name: 'Lindgren', limit: 1 })).resolves.toHaveLength(1);
    });
  });
});
