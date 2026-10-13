/**
 * The subset of Libris XL JSON-LD (https://libris.kb.se) the provider reads. Libris emits most
 * properties as either a single value or an array, so every field is read through `asArray`.
 */
export type OneOrMany<T> = T | T[];

export interface LibrisLink {
  '@id'?: string;
}

export interface LibrisNode extends LibrisLink {
  '@type'?: string;
  '@graph'?: LibrisNode[];
  [key: string]: unknown;
}

export interface LibrisFindResponse {
  totalItems?: number;
  items?: LibrisNode[];
}

export interface LibrisRecordDocument {
  '@graph'?: LibrisNode[];
}
