import type { Type } from '@angular/core';
import type { StandardSchemaV1, StandardSchemaInferOutput } from '@threadplane/render';
import type {
  AskToolDef,
  ClientToolDef,
  ClientToolContinuationOptions,
  ClientToolExecutionOptions,
  FunctionToolDef,
  FunctionToolHandlerContext,
  ViewToolDef,
} from './tool-def';
import type { AcceptComponent } from './component-inputs';
export type { ViewProps } from './component-inputs';

/**
 * Declare an async function tool the model can call; its resolved return value
 * becomes the tool result shipped back to the model.
 *
 * @param description - Natural-language description the model sees.
 * @param schema - Standard Schema (e.g. a Zod object) for the arguments; the
 *   handler's argument type is inferred from it.
 * @param handler - Runs in the browser when the model calls the tool. The second
 *   argument carries an `AbortSignal`; its return type `R` is carried on the
 *   resulting {@link FunctionToolDef}.
 * @param options - Execution policy options, including `idempotent: true` to skip
 *   durable pre-execution claims when a guard is configured.
 * @returns A {@link FunctionToolDef} for inclusion in {@link tools}.
 * @example
 * ```ts
 * const move = action('Move a stop', z.object({ fromDay: z.number() }), (a) => a.fromDay);
 * const registry = tools({ move_stop: move });
 * ```
 */
export function action<S extends StandardSchemaV1, R>(
  description: string,
  schema: S,
  handler: (
    args: StandardSchemaInferOutput<S>,
    context: FunctionToolHandlerContext,
  ) => R | Promise<R>,
  options: ClientToolExecutionOptions = {},
): FunctionToolDef<S, R> {
  return { kind: 'function', description, schema, handler, ...options };
}

/**
 * Render-only component tool — the model fills the component's props from the
 * schema's output; the tool call is auto-acknowledged once the component mounts.
 *
 * The component's signal inputs are checked against the schema output type
 * (strict-but-flexible: every schema key must be a declared input with an
 * assignable type; the component may declare extra inputs the schema doesn't fill).
 * Author the component with `ViewProps<typeof schema>` as the input type set to
 * guarantee the shapes stay aligned.
 *
 * @param description - Natural-language description the model sees.
 * @param schema - Standard Schema defining the props the model must supply.
 * @param component - Angular component whose signal inputs must be compatible with
 *   the schema output. A type-level error is reported here when they diverge.
 * @returns A {@link ViewToolDef} for inclusion in {@link tools}.
 * @example
 * ```ts
 * const schema = z.object({ label: z.string(), day: z.number() });
 * type Inputs = ViewProps<typeof schema>; // { label: string; day: number }
 *
 * \@Component({ ... })
 * class DayCardComponent {
 *   label = input.required<string>();
 *   day   = input.required<number>();
 * }
 *
 * const dayCard = view('Show a day card', schema, DayCardComponent);
 * const registry = tools({ day_card: dayCard });
 * ```
 */
export function view<S extends StandardSchemaV1, C>(
  description: string,
  schema: S,
  component: AcceptComponent<S, C>,
  options: ClientToolContinuationOptions = {},
): ViewToolDef<S, C> {
  return { kind: 'view', description, schema, component: component as Type<C>, ...options };
}

/**
 * Interactive (human-in-the-loop) component tool — the model fills the
 * component's props from the schema's output; the value the component emits
 * back to the framework becomes the tool result sent to the model.
 *
 * The component's signal inputs are checked against the schema output type
 * (strict-but-flexible: every schema key must be a declared input with an
 * assignable type; the component may declare extra inputs the schema doesn't
 * fill). Author the component with `ViewProps<typeof schema>` to derive input
 * prop types directly from the schema.
 *
 * @param description - Natural-language description the model sees.
 * @param schema - Standard Schema defining the props the model must supply.
 * @param component - Angular component whose signal inputs must be compatible with
 *   the schema output. A type-level error is reported here when they diverge.
 * @returns An {@link AskToolDef} for inclusion in {@link tools}.
 * @example
 * ```ts
 * const schema = z.object({ question: z.string(), options: z.array(z.string()) });
 * type Inputs = ViewProps<typeof schema>;
 *
 * \@Component({ ... })
 * class ChoiceCardComponent {
 *   question = input.required<string>();
 *   options  = input.required<string[]>();
 *   // Emits the chosen option back to the model.
 * }
 *
 * const choice = ask('Ask the user to choose', schema, ChoiceCardComponent);
 * const registry = tools({ pick_option: choice });
 * ```
 */
export function ask<S extends StandardSchemaV1, C>(
  description: string,
  schema: S,
  component: AcceptComponent<S, C>,
  options: ClientToolContinuationOptions = {},
): AskToolDef<S, C> {
  return { kind: 'ask', description, schema, component: component as Type<C>, ...options };
}

/**
 * Collect named client tools into a frozen, name-keyed registry.
 *
 * The overload is generic over the entire map (`const M`) so that each tool's
 * precise type ({@link FunctionToolDef}`<S,R>`, {@link ViewToolDef}`<S,C>`, or
 * {@link AskToolDef}`<S,C>`) and every literal key are preserved in the
 * {@link ClientToolRegistry} passed to the `clientTools` input. This lets downstream
 * consumers look up individual tools without losing generic information.
 *
 * @param map - An object literal mapping tool names to tool definitions created
 *   by {@link action}, {@link view}, or {@link ask}.
 * @returns A frozen `Readonly<M>` where `M` is the exact inferred map shape.
 * @example
 * ```ts
 * const move = action('Move a stop', z.object({ fromDay: z.number() }), (a) => a.fromDay);
 * const dayCard = view('Show a day card', z.object({ label: z.string() }), DayCardComponent);
 *
 * const registry = tools({ move_stop: move, day_card: dayCard });
 * // registry.move_stop is FunctionToolDef<...>
 * // registry.day_card  is ViewToolDef<...>
 * ```
 */
export function tools<const M extends Record<string, ClientToolDef>>(map: M): Readonly<M> {
  return Object.freeze({ ...map });
}
