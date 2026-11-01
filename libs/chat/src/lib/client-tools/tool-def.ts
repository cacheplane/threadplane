import type { Type } from '@angular/core';
import type { StandardSchemaV1, StandardSchemaInferInput, StandardSchemaInferOutput } from '@threadplane/render';
import type { ToolCallStatus } from '../agent/tool-call';

export type { StandardSchemaV1, StandardSchemaInferInput, StandardSchemaInferOutput };

/** Runtime context passed to browser-executed function tool handlers. */
export interface FunctionToolHandlerContext {
  /** Aborts when the client tool execution should stop without resolving. */
  readonly signal: AbortSignal;
}

/** Execution policy options for browser-executed function tools. */
export interface ClientToolContinuationOptions {
  /** False when the tool result should be recorded without forcing a continuation. */
  readonly followUp?: boolean;
}

/** Execution policy options for browser-executed function tools. */
export interface ClientToolExecutionOptions extends ClientToolContinuationOptions {
  /** True when the handler may safely re-run and should skip durable pre-claims. */
  readonly idempotent?: boolean;
}

/** Diagnostic emitted when client-tool continuation would exceed the configured max turn count. */
export interface ClientToolContinuationLimitEvent {
  readonly maxTurns: number;
  readonly attemptedTurn: number;
  readonly toolCallIds: readonly string[];
  readonly toolNames: readonly string[];
}

/** Policy for automatic client-tool continuation. */
export interface ClientToolContinuationPolicy {
  /** Maximum consecutive client-tool continuation groups per user turn. Default: 10. Use 0 for unlimited. */
  readonly maxTurns?: number;
  /** Called when the max-turn guard stops a continuation group. */
  readonly onLimit?: (event: ClientToolContinuationLimitEvent) => void;
}

/** The execution phase exposed to a mounted client tool component. */
export type ClientToolLifecyclePhase = 'running' | 'complete' | 'error';

/** Execution status, result availability, and error details supplied to a client tool view. */
export interface ClientToolLifecycle {
  readonly id: string;
  readonly name: string;
  readonly status: ToolCallStatus;
  readonly phase: ClientToolLifecyclePhase;
  readonly hasResult: boolean;
  readonly result?: unknown;
  readonly error?: unknown;
}

/** Schema output properties augmented with optional execution status and lifecycle details. */
export type ClientToolViewProps<S extends StandardSchemaV1> =
  StandardSchemaInferOutput<S> & {
    readonly status?: ToolCallStatus;
    readonly clientTool?: ClientToolLifecycle;
  };

/** Precise authored function tool — what `action()` returns. Carries the schema
 *  `S` and the handler's resolved return type `R`. */
export interface FunctionToolDef<S extends StandardSchemaV1 = StandardSchemaV1, R = unknown> {
  readonly kind: 'function';
  readonly description: string;
  readonly schema: S;
  readonly followUp?: boolean;
  readonly idempotent?: boolean;
  readonly handler: (
    args: StandardSchemaInferOutput<S>,
    context: FunctionToolHandlerContext,
  ) => R | Promise<R>;
}

/** Bivariant union member used only for registry storage/iteration. The handler
 *  param is `any` (NOT `never`): `any` is simultaneously a supertype any precise
 *  `FunctionToolDef<S,R>` is assignable to under `strictFunctionTypes`, AND
 *  callable by internal code that has narrowed by `kind` and parsed runtime args.
 *  A `never` param would satisfy the former but break the latter. */
export interface AnyFunctionToolDef {
  readonly kind: 'function';
  readonly description: string;
  readonly schema: StandardSchemaV1;
  readonly followUp?: boolean;
  readonly idempotent?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bivariance escape hatch; see note above
  readonly handler: (args: any, context: FunctionToolHandlerContext) => unknown | Promise<unknown>;
}

/** Defines a schema-backed Angular tool view that the coordinator automatically acknowledges. */
export interface ViewToolDef<S extends StandardSchemaV1 = StandardSchemaV1, C = unknown> {
  readonly kind: 'view';
  readonly description: string;
  readonly schema: S;
  readonly followUp?: boolean;
  readonly component: Type<C>;
}

/** Defines a schema-backed Angular tool view that resolves through a rendered user interaction. */
export interface AskToolDef<S extends StandardSchemaV1 = StandardSchemaV1, C = unknown> {
  readonly kind: 'ask';
  readonly description: string;
  readonly schema: S;
  readonly followUp?: boolean;
  readonly component: Type<C>;
}

/** A client tool the model can call; executed in the browser. */
export type ClientToolDef =
  | AnyFunctionToolDef
  | ViewToolDef
  | AskToolDef;

/** A frozen, name-keyed registry of client tools. */
export type ClientToolRegistry = Readonly<Record<string, ClientToolDef>>;
