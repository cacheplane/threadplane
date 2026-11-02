import { Type } from '@angular/core';
import type { Spec, StateStore, ComputedFunction } from '@json-render/core';
import type { StandardSchemaV1 } from './standard-schema';

/** Inputs passed to a dynamically rendered Angular view, combining resolved props with child keys, spec, bindings, and event emission. */
export interface AngularComponentInputs {
  /** Two-way binding paths: prop name → absolute state path */
  bindings?: Record<string, string>;
  /** Emit a named event */
  emit: (event: string) => void;
  /** Whether the spec is currently streaming */
  loading?: boolean;
  /** Child element keys for recursive rendering */
  childKeys: string[];
  /** The full spec (for child resolution) */
  spec: Spec;
  /** Dynamic resolved props are spread as additional inputs */
  [key: string]: unknown;
}

/** Angular component class that can be registered as the renderer for a spec element type. */
export type AngularComponentRenderer = Type<unknown>;

/**
 * A view registry entry. Bare `Type` form is the legacy shape; the
 * object form lets consumers attach a per-component fallback that
 * mounts while any state-bound prop on the element is still
 * unresolved. The fallback is monotonic per element instance: once
 * the real component mounts, subsequent re-renders never revert to
 * fallback even if a prop later resolves to undefined.
 */
export interface RenderViewEntry {
  component: Type<unknown>;
  fallback?: Type<unknown>;
  /** Optional props contract for this component (Zod/Valibot/ArkType via
   * Standard Schema). Enforced as a MOUNT-READINESS GATE: while a streaming
   * tool call's props do not yet validate against this schema, the element's
   * fallback is shown instead of the real component (sync validation only).
   * Consumers (e.g. client-tools) also read it to advertise the component
   * to a model and to validate incoming props. */
  schema?: StandardSchemaV1;
  /** Optional human/model-facing description of what this component renders. */
  description?: string;
}

/** A fully-normalized registry entry: real component + a guaranteed fallback,
 * plus the optional props schema (mount-readiness gate) and description. */
export interface NormalizedEntry {
  component: Type<unknown>;
  fallback: Type<unknown>;
  schema?: StandardSchemaV1;
  description?: string;
}

/** Lookup and enumeration of normalized Angular render entries by their registered names. */
export interface AngularRegistry {
  /** The full normalized entry for a registered name, or undefined. The single
   * accessor — component, fallback, schema, and description all hang off it. */
  getEntry(name: string): NormalizedEntry | undefined;
  names(): string[];
}

/**
 * Options for {@link provideRender} — the registry, state, computed functions,
 * and action handlers the render engine uses to turn a spec into live Angular
 * components. Every field is optional.
 */
export interface RenderConfig {
  /** Set false to disable automatic development browser collection for this render tree. */
  telemetry?: boolean;
  /** Component registry mapping spec element `type`s to Angular components. */
  registry?: AngularRegistry;
  /** Backing state store that `$bindState` paths read from and interactive elements write to. */
  store?: StateStore;
  /** Named computed functions a spec can reference (e.g. via `$compute`) to derive values from state. */
  functions?: Record<string, ComputedFunction>;
  /** Named action handlers invoked when interactive elements fire (e.g. a Button's `onClick`). */
  handlers?: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>;
}
