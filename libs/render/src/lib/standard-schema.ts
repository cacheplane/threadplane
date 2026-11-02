// Vendored from the Standard Schema spec (https://standardschema.dev) — the
// spec is published expressly to be copied in rather than depended on. Zero
// runtime; types only. Lets a RenderViewEntry carry any spec-compliant
// validator (Zod/Valibot/ArkType) without a package dependency.
//
// The upstream spec models the nested types under a `StandardSchemaV1`
// namespace; this repo forbids TS namespaces (@typescript-eslint/no-namespace),
// so the nested types are flattened to top-level `StandardSchema*` aliases. The
// `StandardSchemaV1` interface itself is unchanged from the spec.

/**
 * Standard Schema v1 validation contract for a render view's props.
 * The contract permits asynchronous validation, but only synchronous results gate render mount readiness.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>;
}

export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (
    value: unknown,
  ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  readonly types?: StandardSchemaTypes<Input, Output> | undefined;
}

export type StandardSchemaResult<Output> =
  | StandardSchemaSuccessResult<Output>
  | StandardSchemaFailureResult;

export interface StandardSchemaSuccessResult<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardSchemaFailureResult {
  readonly issues: ReadonlyArray<StandardSchemaIssue>;
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined;
}

export interface StandardSchemaPathSegment {
  readonly key: PropertyKey;
}

export interface StandardSchemaTypes<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

/** Infers the input type advertised by a Standard Schema validator. */
export type StandardSchemaInferInput<Schema extends StandardSchemaV1> =
  NonNullable<Schema['~standard']['types']>['input'];

/** Infers the validated output type advertised by a Standard Schema validator. */
export type StandardSchemaInferOutput<Schema extends StandardSchemaV1> =
  NonNullable<Schema['~standard']['types']>['output'];
