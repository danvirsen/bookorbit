// Libris XL serves JSON-LD, where most properties arrive as either a single
// value or an array, so every field the provider reads is typed as both.
export type OneOrMany<T> = T | T[];

export interface LibrisLink {
  '@id'?: string;
}

export interface LibrisPersonNode {
  '@id'?: string;
  '@type'?: string;
  name?: OneOrMany<string>;
  givenName?: OneOrMany<string>;
  familyName?: OneOrMany<string>;
  lifeSpan?: OneOrMany<string>;
  description?: OneOrMany<string>;
  image?: OneOrMany<LibrisLink>;
  exactMatch?: OneOrMany<LibrisLink>;
}

// find.jsonld embeds every matching person in full, so a search needs no
// follow-up record requests.
export interface LibrisPersonSearchResponse {
  totalItems?: number;
  items?: LibrisPersonNode[];
}

export interface LibrisPersonRecord {
  '@graph'?: LibrisPersonNode[];
}

export interface ParsedLibrisAuthor {
  providerId: string;
  name: string;
  description?: string;
  birthYear?: number;
  deathYear?: number;
  wikidataId?: string;
}

// Libris only serves its own copy of a photo through short-lived signed links,
// so the photo is read from the Wikidata item it was copied from.
export interface WikidataEntityResponse {
  entities?: Record<
    string,
    {
      claims?: {
        P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[];
      };
    }
  >;
}
