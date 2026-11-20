import type { PlainValue } from './tool.js';

/**
 * The part of Standard Schema v1 a session reads. Zod, Valibot, ArkType and any
 * other library that implements the standard produce values of this shape, so a
 * session needs no schema dependency of its own.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

/** What a Standard Schema reports for one value. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string }[] };

const witness = '~threadplane.state';

/**
 * A state type declared without a schema. It holds no value: the session trusts
 * that the backend sends this shape and checks nothing at runtime.
 */
export interface StateWitness<TState> {
  readonly [witness]: 'type';
  /** Never present. It only carries the declared type. */
  readonly '~type'?: TState;
}

/** How a session is told its state type: a type alone, or a schema that also checks it. */
export type StateDeclaration<TState = unknown> =
  | StateWitness<TState>
  | StandardSchemaV1<unknown, TState>;

/** The state type a declaration stands for; `unknown` when there is none. */
export type InferState<TDeclaration> = TDeclaration extends StateWitness<
  infer TState
>
  ? TState
  : TDeclaration extends StandardSchemaV1<unknown, infer TState>
  ? TState
  : unknown;

// The data a snapshot can hold, written out of the given type. An open field
// (`unknown`) is kept as it is: a snapshot reads it as plain data. A type that
// is already plain data is kept whole, which also stops the walk at
// `PlainValue`, a type that refers to itself and would otherwise never end.
type Portable<T> = unknown extends T
  ? T
  : [T] extends [PlainValue]
  ? T
  : T extends string | number | boolean | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
  ? never
  : T extends object
  ? { [K in keyof T]: Portable<T[K]> }
  : never;

/**
 * Resolves to `unknown` for a state type a session can hold, and to a sentence
 * naming the problem for one it cannot. Used as a constraint so the sentence is
 * what the compiler reports. `any` satisfies every constraint, so it is the one
 * unusable type this cannot reject.
 */
export type StateTypeCheck<TState> = unknown extends TState
  ? 'State needs a declared shape. Leave the state type out to keep it untyped.'
  : [TState] extends [object]
  ? [TState] extends [readonly unknown[]]
    ? 'State must be an object, not an array.'
    : [TState] extends [Portable<TState>]
    ? unknown
    : 'State must be plain data. Functions and class instances such as Date cannot be held in a snapshot.'
  : 'State must be an object.';

/**
 * Declares a session's state type without a schema.
 *
 * @example
 * ```ts
 * const session = createSession({
 *   ...options,
 *   stateType: type<{ todos: Todo[]; draft?: string }>(),
 * });
 * session.getSnapshot().state?.todos; // readonly Todo[]
 * ```
 *
 * The session does not check what the backend sends. Pass a Standard Schema,
 * such as a Zod object, in place of `type()` to have each state checked as it
 * arrives.
 */
export function type<
  TState extends TCheck,
  TCheck = StateTypeCheck<TState>
>(): StateWitness<TState> {
  return typeOnly as StateWitness<TState>;
}
const typeOnly: StateWitness<unknown> = Object.freeze({ [witness]: 'type' });

/**
 * A partial state a caller sends with a submission. Typed sessions accept the
 * keys of their declared state; untyped sessions accept any plain record.
 */
export type AgentStateUpdate<TState = unknown> = unknown extends TState
  ? Readonly<Record<string, PlainValue>>
  : Partial<TState>;

/** The outcome of checking one state a backend reported. */
export type StateReading =
  | { readonly valid: true; readonly value: unknown }
  | { readonly valid: false; readonly issues: readonly string[] };

function isSchema(value: unknown): value is StandardSchemaV1 {
  if (value === null || typeof value !== 'object') return false;
  const standard = (value as { readonly '~standard'?: unknown })['~standard'];
  return (
    standard !== null &&
    typeof standard === 'object' &&
    typeof (standard as { readonly validate?: unknown }).validate === 'function'
  );
}

/**
 * Checks a state a backend reported against a session's declaration. For
 * session implementations.
 *
 * With no declaration, or a `type()` declaration, every value is valid and
 * returned as given. With a schema, the value is the schema's output, so a
 * transformed field holds its transformed value. A schema that validates
 * asynchronously is reported as invalid: a snapshot is published synchronously
 * and cannot wait for it.
 */
export function readState(
  declaration: StateDeclaration | undefined,
  value: unknown
): StateReading {
  if (!isSchema(declaration)) return { valid: true, value };
  let result: unknown;
  try {
    result = declaration['~standard'].validate(value);
  } catch (error) {
    return {
      valid: false,
      issues: [error instanceof Error ? error.message : 'Validation threw.'],
    };
  }
  if (result === null || typeof result !== 'object')
    return { valid: false, issues: ['The schema returned no result.'] };
  if (typeof (result as { readonly then?: unknown }).then === 'function') {
    // The validation is abandoned, so its rejection must not surface as unhandled.
    (result as Promise<unknown>).then(undefined, () => undefined);
    return {
      valid: false,
      issues: ['State schemas must validate synchronously.'],
    };
  }
  const { issues, value: output } = result as {
    readonly issues?: unknown;
    readonly value?: unknown;
  };
  if (issues === undefined || issues === null)
    return { valid: true, value: output };
  return {
    valid: false,
    issues: Array.isArray(issues)
      ? issues.map((issue: unknown) =>
          issue !== null &&
          typeof issue === 'object' &&
          typeof (issue as { readonly message?: unknown }).message === 'string'
            ? (issue as { readonly message: string }).message
            : 'Invalid state.'
        )
      : ['Invalid state.'],
  };
}
