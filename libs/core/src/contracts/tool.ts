/** Data authored for portable snapshots. No schema inference or runtime conversion. */
export type PlainValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly PlainValue[]
  | { readonly [key: string]: PlainValue };

/**
 * True for `unknown` and `any` only. `unknown extends T` alone is not that
 * test in a program compiled without strict null checks: there it also holds
 * for `{}`, for a record of `any` and for an object type whose fields are all
 * optional, which would then lose their fields. None of those is `any`, and
 * all of them are object types, which `unknown` is not.
 */
type IsUntyped<T> = 0 extends 1 & T
  ? true
  : unknown extends T
  ? [T] extends [object]
    ? false
    : true
  : false;

/**
 * Recursively projects readonly data, mapping unknown to PlainValue, void to undefined, and functions to never.
 * PlainValue itself is kept as it is: it is readonly already, and it refers to
 * itself, so walking it would never end.
 */
export type DeepReadonly<T> = IsUntyped<T> extends true
  ? PlainValue
  : [T, PlainValue] extends [PlainValue, T]
  ? PlainValue
  : T extends void
  ? undefined
  : T extends string | number | boolean | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
  ? never
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : never;

/** Describes arguments and results only; execution is a separate capability. */
export interface ToolContract {
  readonly args: unknown;
  readonly result: unknown;
}

// Unspecified tools have the broad plain-data view. Authored interfaces retain
// their fields without needing a string index signature. void is represented by
// undefined in a snapshot (for no-input calls and handlers without a result).
type SnapshotValue<T> = unknown extends T
  ? PlainValue
  : [T] extends [void]
  ? undefined
  : DeepReadonly<T>;

/** Tool execution stage; pending calls already have finalized, decoded arguments. */
export type ToolCallStatus = 'pending' | 'running' | 'complete' | 'error';

/** A mapped union preserves each declared name's argument/result relationship.
 * pending means decoded, finalized arguments awaiting execution, not partial
 * streamed JSON. A session that shows argument fragments lists them apart as
 * {@link StreamingToolCall} entries until they are finalized.
 * `parts` holds a result's structured parts when the backend returned them,
 * such as text and media parts; `result` or `error` then holds their text. */
export type ToolCall<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = {
  [K in keyof TTools & string]: TTools[K] extends {
    readonly args: infer A;
    readonly result: infer R;
  }
    ? {
        readonly id: string;
        readonly name: K;
        readonly args: SnapshotValue<A>;
      } & (
        | { readonly status: 'pending' | 'running' }
        | {
            readonly status: 'complete';
            readonly result: SnapshotValue<R>;
            readonly parts?: readonly PlainValue[];
          }
        | {
            readonly status: 'error';
            readonly error: string;
            readonly parts?: readonly PlainValue[];
          }
      )
    : never;
}[keyof TTools & string];

/**
 * A tool call the model is still writing. Its arguments are not final, so it
 * is not a {@link ToolCall} and is listed apart, in a snapshot's
 * `streamingToolCalls`. Once the arguments are complete the session removes it
 * from that list and adds a `ToolCall` with the same `id` to `toolCalls`.
 */
export interface StreamingToolCall {
  readonly id: string;
  readonly name: string;
  /** The argument text received so far, exactly as the model wrote it. */
  readonly argsText: string;
  /**
   * The arguments as far as they can be read from `argsText`, when the session
   * parses partial JSON. A best effort: fields may be missing or cut short.
   */
  readonly args?: PlainValue;
}
