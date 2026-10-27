import type {
  MarkdownNode as ParserNode,
  MarkdownDocumentNode as ParserDocumentNode,
  CitationDefinition as ParserCitationDefinition,
  LinkDefinition as ParserLinkDefinition,
} from '@cacheplane/partial-markdown';

// This transform is private to the Markdown domain. Parent links never escape.
type Owned<T> = T extends ReadonlyMap<infer K, infer V>
  ? ReadonlyMap<K, Owned<V>>
  : T extends object
  ? { readonly [K in keyof T]: K extends 'parent' ? null : Owned<T[K]> }
  : T;

export type MarkdownNode = Owned<ParserNode>;
export type MarkdownDocumentNode = Owned<ParserDocumentNode>;
export type CitationDefinition = Owned<ParserCitationDefinition>;
export type LinkDefinition = Owned<ParserLinkDefinition>;

export interface MarkdownDocument {
  readonly generation: string;
  readonly phase: 'streaming' | 'complete';
  readonly content: string;
}
export interface MarkdownSnapshot {
  readonly document: MarkdownDocument;
  readonly root: MarkdownDocumentNode | null;
}
export interface MarkdownOptions {
  readonly violationPolicy?: 'throw' | 'rebuild';
}
export interface Markdown {
  readonly getSnapshot: () => MarkdownSnapshot;
  readonly subscribe: (notify: () => void) => () => void;
  readonly update: (document: MarkdownDocument) => void;
  readonly dispose: () => void;
}
