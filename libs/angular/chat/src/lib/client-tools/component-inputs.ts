import type { InputSignal, InputSignalWithTransform, Type } from '@angular/core';
import type { StandardSchemaV1, StandardSchemaInferOutput } from '@threadplane/angular/render';
import type { Prettify } from '../internals/prettify';

/** Value type carried by an Angular signal input. */
type InputValue<P> =
  P extends InputSignal<infer T> ? T :
  P extends InputSignalWithTransform<infer T, infer _U> ? T :
  never;

/** A component instance's declared signal inputs, as a plain prop bag.
 *
 *  Implementation note: Angular's `InputSignal` and `InputSignalWithTransform`
 *  use `InputSignalNode` in an invariant position, making them invariant in their
 *  type parameters under TypeScript's structural system. `InputSignal<number>`
 *  does NOT extend `InputSignal<unknown>`. We therefore use `any` in the filter
 *  predicate — `any` is a two-way assignability wildcard that correctly subsumes
 *  all concrete instantiations without widening the extracted value type. */
export type ComponentInputs<C> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- required; see note above
  [K in keyof C as C[K] extends InputSignal<any> | InputSignalWithTransform<any, any>
    ? K
    : never]: InputValue<C[K]>;
};

/** STRICT: every prop the schema PRODUCES must be a declared input with an
 *  assignable type. FLEXIBLE: the component may declare extra inputs the schema
 *  doesn't fill. A schema key absent from `Inputs` maps to `never`, so its
 *  (non-never) value fails assignment and the error pins to that prop.
 *
 *  This mapped type is homomorphic over `keyof Out`, so it preserves the
 *  optionality (`?`) of each schema prop. A consequence: an OPTIONAL schema prop
 *  is accepted against a `required` component input — the compiler cannot know
 *  the model will actually supply it. That residual case (required input not
 *  guaranteed by the schema) is caught at runtime by the schema-readiness mount
 *  gate, which holds the fallback until the streamed props validate. Compile
 *  time blocks structural mismatches; runtime blocks missing-but-required props. */
export type CompatibleProps<Out, Inputs> = {
  [K in keyof Out]: K extends keyof Inputs ? Inputs[K] : never;
};

/** The accepted `component` parameter type for `view`/`ask`: the real component
 *  `Type<C>` when the schema output is compatible, else a labelled error tuple
 *  that surfaces both shapes in the compiler message.
 *
 *  Implementation note: `C extends ...` (distributive over C) lets TypeScript
 *  infer `C` from the `Type<C>` arm first, then verify the constraint. A bare
 *  conditional on the param type blocks inference when C appears only on the
 *  right-hand side of the inner `extends`. */
export type AcceptComponent<S extends StandardSchemaV1, C> =
  C extends (
    StandardSchemaInferOutput<S> extends CompatibleProps<StandardSchemaInferOutput<S>, ComponentInputs<C>>
      ? C
      : never
  )
    ? Type<C>
    : readonly [
        'Schema output is not assignable to this component\'s inputs',
        StandardSchemaInferOutput<S>,
        ComponentInputs<C>,
      ];

/** Reverse helper: derive a component's input prop types FROM a schema, so a
 *  component authored straight from the schema is guaranteed compatible. */
export type ViewProps<S extends StandardSchemaV1> = Prettify<StandardSchemaInferOutput<S>>;
