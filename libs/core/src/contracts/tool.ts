/** Data authored for portable snapshots. No schema inference or runtime conversion. */
export type PlainValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly PlainValue[]
  | { readonly [key: string]: PlainValue };

export type DeepReadonly<T> = unknown extends T
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

export type ToolCallStatus = 'pending' | 'running' | 'complete' | 'error';

/** A mapped union preserves each declared name's argument/result relationship.
 * pending means decoded, finalized arguments awaiting execution, not partial
 * streamed JSON. Adapters keep argument fragments private until finalized. */
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
        | { readonly status: 'complete'; readonly result: SnapshotValue<R> }
        | { readonly status: 'error'; readonly error: string }
      )
    : never;
}[keyof TTools & string];
