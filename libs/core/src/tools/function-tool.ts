import type { PlainValue } from '../contracts/tool.js';
import type { ExecutionContext } from './execution-context.js';

type Portable<T> = T extends string | number | boolean | null | undefined | void
  ? T
  : T extends (...args: never[]) => unknown
  ? never
  : T extends object
  ? { [K in keyof T]: Portable<T[K]> }
  : never;
type IsPortable<T> = 0 extends 1 & T
  ? false
  : unknown extends T
  ? true
  : [T] extends [Portable<T>]
  ? true
  : false;

/** Authored TypeScript arguments/results, with no inference from JSON metadata,
 * validation, conversion, or transforms. Normal interfaces need no index key.
 * Handlers receive an isolated mutable copy of their finalized arguments. */
export type FunctionTool<A, R> = IsPortable<A> extends true
  ? IsPortable<R> extends true
    ? {
        readonly description: string;
        /** Optional caller-authored JSON Schema, sent unchanged as metadata. */
        readonly parameters?: PlainValue;
        /** Defaults to true; false persists the result without another run. */
        readonly followUp?: boolean;
        /** true bypasses an optional execution store. */
        readonly idempotent?: boolean;
        readonly handler: (
          args: A,
          context: ExecutionContext
        ) => R | Promise<R>;
      }
    : never
  : never;

/** Constraint for heterogeneous catalogs; never is only the storage boundary,
 * never a callable fallback for an untyped handler. */
export interface FunctionToolDefinition {
  readonly description: string;
  readonly parameters?: PlainValue;
  readonly followUp?: boolean;
  readonly idempotent?: boolean;
  readonly handler: (args: never, context: ExecutionContext) => unknown;
}

export type ToolContracts<T extends Record<string, FunctionToolDefinition>> = {
  [K in keyof T]: {
    args: Parameters<T[K]['handler']>[0];
    result: Awaited<ReturnType<T[K]['handler']>>;
  };
};

/** Rejects unsupported inferred data without widening to any or unknown. */
export type CheckedTools<T extends Record<string, FunctionToolDefinition>> = {
  [K in keyof T]: FunctionTool<
    Parameters<T[K]['handler']>[0],
    Awaited<ReturnType<T[K]['handler']>>
  >;
};
