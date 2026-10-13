import { Test, TestingModule } from '@nestjs/testing';
import { MetadataProviderKey, ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { FIND_RESPONSE, TITANENS_RECORD } from './libris-test-fixtures';
import { LibrisProvider } from './libris.provider';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('LibrisProvider', () => {
  let provider: LibrisProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: '' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
    itunes: { enabled: true, coverResolution: 'high' },
    audible: { enabled: false, domain: 'com' },
    audnexus: { enabled: false },
    librofm: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
    kobo: { enabled: false, country: 'us', language: 'en' },
    lubimyczytac: { enabled: false },
    aladin: { enabled: false, ttbKey: '' },
    libris: { enabled: true },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LibrisProvider, { provide: ProviderConfigService, useValue: { getConfig: vi.fn().mockResolvedValue(mockConfig) } }],
    }).compile();
    provider = module.get(LibrisProvider);
    providerConfig = module.get(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(...responses: Response[]) {
    const fetch = vi.fn();
    for (const response of responses) fetch.mockResolvedValueOnce(response);
    global.fetch = fetch;
    return fetch;
  }

  it('declares itself as an identifiable portrait-cover provider', () => {
    expect(provider.key).toBe(MetadataProviderKey.LIBRIS);
    expect(provider.identifiable).toBe(true);
    expect(provider.coverShape).toBe('portrait');
  });

  describe('search', () => {
    it('returns nothing and makes no request when disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, libris: { enabled: false } });
      const fetch = mockFetch();
      expect(await provider.search({ title: 'Titanens förbannelse' })).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('finds records by ISBN and loads each one', async () => {
      const fetch = mockFetch(jsonResponse({ totalItems: 1, items: [FIND_RESPONSE.items[0]] }), jsonResponse(TITANENS_RECORD));

      const result = await provider.search({ isbn: '978-91-7979-309-8' });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ providerId: 'ctv82fx49rndh4z7', title: 'Titanens förbannelse', isbn13: '9789179793098' });
      const findUrl = new URL(fetch.mock.calls[0][0] as string);
      expect(findUrl.pathname).toBe('/find.jsonld');
      expect(findUrl.searchParams.get('identifiedBy.value')).toBe('9789179793098');
      expect(findUrl.searchParams.get('@type')).toBe('Instance');
      expect(fetch.mock.calls[1][0]).toBe('https://libris.kb.se/ctv82fx49rndh4z7/data.jsonld');
    });

    it('falls back to a title and author search when the ISBN is unknown', async () => {
      const fetch = mockFetch(
        jsonResponse({ totalItems: 0, items: [] }),
        jsonResponse({ totalItems: 1, items: [FIND_RESPONSE.items[0]] }),
        jsonResponse(TITANENS_RECORD),
      );

      const result = await provider.search({ isbn: '9789179793098', title: 'Titanens förbannelse', author: 'Rick Riordan' });

      expect(result).toHaveLength(1);
      expect(new URL(fetch.mock.calls[1][0] as string).searchParams.get('q')).toBe('Titanens förbannelse Rick Riordan');
    });

    it('caps record loads at maxCandidatesPerProvider and skips records that fail', async () => {
      const fetch = mockFetch(jsonResponse(FIND_RESPONSE), jsonResponse(TITANENS_RECORD), jsonResponse({}, 404));

      const capped = await provider.search({ title: 'Titanens förbannelse', maxCandidatesPerProvider: 1 });
      expect(capped).toHaveLength(1);
      expect(new URL(fetch.mock.calls[0][0] as string).searchParams.get('_limit')).toBe('1');
    });

    it('returns nothing without any query', async () => {
      const fetch = mockFetch();
      expect(await provider.search({})).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns nothing on a non-ok find response', async () => {
      mockFetch(jsonResponse({}, 503));
      expect(await provider.search({ title: 'x' })).toEqual([]);
    });
  });

  describe('lookupById', () => {
    it('loads a record by XL id or catalog URL', async () => {
      mockFetch(jsonResponse(TITANENS_RECORD));
      const result = await provider.lookupById('https://libris.kb.se/ctv82fx49rndh4z7');
      expect(result?.title).toBe('Titanens förbannelse');
    });

    it('resolves a pre-XL numeric bib id through its sameAs link', async () => {
      const fetch = mockFetch(jsonResponse({ totalItems: 1, items: [FIND_RESPONSE.items[0]] }), jsonResponse(TITANENS_RECORD));

      const result = await provider.lookupById('http://libris.kb.se/bib/12504697');

      expect(result?.providerId).toBe('ctv82fx49rndh4z7');
      expect(new URL(fetch.mock.calls[0][0] as string).searchParams.get('sameAs.@id')).toBe('http://libris.kb.se/resource/bib/12504697');
      expect(fetch.mock.calls[1][0]).toBe('https://libris.kb.se/ctv82fx49rndh4z7/data.jsonld');
    });

    it('returns null without a request for an id Libris cannot have issued', async () => {
      const fetch = mockFetch();
      expect(await provider.lookupById('not-a-libris-id')).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns null when disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, libris: { enabled: false } });
      expect(await provider.lookupById('ctv82fx49rndh4z7')).toBeNull();
    });

    it('returns null when the record is missing', async () => {
      mockFetch(jsonResponse({}, 404));
      expect(await provider.lookupById('ctv82fx49rndh4z7')).toBeNull();
    });

    it('rethrows throttling', async () => {
      mockFetch(jsonResponse({}, 429));
      await expect(provider.lookupById('ctv82fx49rndh4z7')).rejects.toBeInstanceOf(ProviderThrottleError);
    });
  });
});
