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

/** Readonly Markdown syntax node projected from the parser with parent references set to null. */
export type MarkdownNode = Owned<ParserNode>;
/** Readonly document root containing parsed children and reference definitions, with no parent links. */
export type MarkdownDocumentNode = Owned<ParserDocumentNode>;
/** Owned citation definition used to resolve a Markdown citation reference and its display index. */
export type CitationDefinition = Owned<ParserCitationDefinition>;
/** Owned link reference definition containing the destination and title for a reference label. */
export type LinkDefinition = Owned<ParserLinkDefinition>;

/** Cumulative Markdown source for a generation; streaming updates append until completion, and a new generation replaces it. */
export interface MarkdownDocument {
  readonly generation: string;
  readonly phase: 'streaming' | 'complete';
  readonly content: string;
}
/** Accepted Markdown source document and its owned partial syntax tree. */
export interface MarkdownSnapshot {
  readonly document: MarkdownDocument;
  readonly root: MarkdownDocumentNode | null;
}
/** Controls whether invalid same-generation document transitions throw (the default) or rebuild the parser. */
export interface MarkdownOptions {
  readonly violationPolicy?: 'throw' | 'rebuild';
}
/** Application-owned incremental Markdown parser with snapshot observation, document updates, and explicit disposal. */
export interface Markdown {
  readonly getSnapshot: () => MarkdownSnapshot;
  readonly subscribe: (notify: () => void) => () => void;
  readonly update: (document: MarkdownDocument) => void;
  readonly dispose: () => void;
}
