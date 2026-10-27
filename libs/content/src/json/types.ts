/** Best-effort partial JSON, with undefined for unresolved primitive values. */
export type JsonPartialValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | readonly JsonPartialValue[]
  | { readonly [key: string]: JsonPartialValue };

interface JsonNodeBase {
  /** Stable within a document generation, not across replacement. */
  readonly id: number;
  readonly status: 'incomplete' | 'complete';
}
export type JsonNode = JsonNodeBase &
  (
    | { readonly kind: 'null'; readonly value: null | undefined }
    | { readonly kind: 'boolean'; readonly value: boolean | undefined }
    | {
        readonly kind: 'number';
        readonly value: number | undefined;
        readonly buffer: string;
      }
    | {
        readonly kind: 'string';
        readonly value: string | undefined;
        readonly buffer: string;
      }
    | {
        readonly kind: 'array';
        readonly value: readonly JsonPartialValue[];
        readonly children: readonly JsonNode[];
      }
    | {
        readonly kind: 'object';
        readonly value: Readonly<Record<string, JsonPartialValue>>;
        readonly children: Readonly<Record<string, JsonNode>>;
      }
  );

export interface JsonDocument {
  readonly generation: string;
  readonly phase: 'streaming' | 'complete';
  readonly content: string;
}
export interface JsonError {
  readonly code: 'INVALID_SYNTAX' | 'UNEXPECTED_END' | 'TRAILING_CONTENT';
  readonly message: string;
  readonly index: number;
  readonly line: number;
  readonly column: number;
}
export interface JsonSnapshot {
  readonly document: JsonDocument;
  readonly root: JsonNode | null;
  /** Complete JSON syntax with no diagnostic, independently of delivery phase. */
  readonly complete: boolean;
  readonly error: JsonError | null;
}
export interface JsonOptions {
  readonly violationPolicy?: 'throw' | 'rebuild';
}
export interface Json {
  readonly getSnapshot: () => JsonSnapshot;
  readonly subscribe: (notify: () => void) => () => void;
  readonly update: (document: JsonDocument) => void;
  readonly dispose: () => void;
}
