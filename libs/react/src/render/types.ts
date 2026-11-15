import type { ComponentType, ReactNode } from 'react';
import type { UIElement } from '@json-render/core';
import type { DeepReadonly } from '@threadplane/core';

/** Readonly element definition with component type, unresolved props, children, visibility, repeat configuration, and event bindings. */
export type RenderElementData = DeepReadonly<
  Pick<UIElement, 'type' | 'props' | 'children' | 'visible' | 'repeat' | 'on'>
>;
/** Caller-prepared tree identified by a root key and a record of keyed element definitions. */
export interface RenderSpecData {
  readonly root: string;
  readonly elements: Readonly<Record<string, RenderElementData>>;
}
/** Recursive readonly plain data accepted as resolved view props and computed-function arguments or results. */
export type RenderValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | readonly RenderValue[]
  | { readonly [key: string]: RenderValue };
/** Resolved component props, binding paths, rendered children, and element/loading metadata passed to registry views. */
export interface RenderViewProps {
  readonly props: Readonly<Record<string, RenderValue>>;
  readonly bindings?: Readonly<Record<string, string>>;
  readonly children?: ReactNode;
  readonly elementKey: string;
  readonly loading?: boolean;
  /**
   * Runs the bindings the element declares under `on[event]`. Does nothing
   * unless the app passed `handlers` to `RenderSpec`. `payload` is plain data
   * merged over each binding's params.
   */
  readonly emit: (
    event: string,
    payload?: Readonly<Record<string, RenderValue>>
  ) => void;
  /**
   * Asks the app to write `value` to the state path the named prop is bound
   * to (see `bindings`). Does nothing for an unbound prop, or unless the app
   * passed `onStateChange` to `RenderSpec`.
   */
  readonly setValue: (prop: string, value: RenderValue) => void;
}
/** An app function a spec can call by name; params are owned and frozen. A returned promise delays the binding's follow-up. */
export type RenderHandler = (
  params: Readonly<Record<string, RenderValue>>
) => unknown;
/** Named app functions available to a spec's event bindings. A spec can call only what is listed here. */
export type ReactRenderHandlers = Readonly<Record<string, RenderHandler>>;
/** App-owned synchronous admission for one mounted view lifetime. */
export interface RenderReadinessEntry {
  readonly kind: 'readiness';
  readonly component: ComponentType<RenderViewProps>;
  readonly isReady: (props: Readonly<Record<string, RenderValue>>) => boolean;
  readonly fallback?: ComponentType<RenderViewProps>;
}
/** Maps spec component names to React views or entries that gate mounting on synchronous readiness. */
export type ReactRenderRegistry = Readonly<
  Record<string, ComponentType<RenderViewProps> | RenderReadinessEntry>
>;
/** A pure synchronous calculation; arguments are owned and recursively frozen. */
export type RenderComputedFunction = (
  args: Readonly<Record<string, RenderValue>>
) => RenderValue;
/** Named pure synchronous functions available while resolving computed expressions in element props. */
export type ReactRenderFunctions = Readonly<
  Record<string, RenderComputedFunction>
>;
/** Supplies a nullable render tree, component registry, state and computed functions, optional handlers and a state-change callback, plus loading state and a fallback component. */
export interface RenderSpecProps {
  readonly spec: RenderSpecData | null;
  readonly registry: ReactRenderRegistry;
  readonly state?: DeepReadonly<Record<string, unknown>>;
  readonly functions?: ReactRenderFunctions;
  /**
   * Makes the tree interactive: the app functions its event bindings may call.
   * Without it a view's `emit` does nothing. Keep stable.
   */
  readonly handlers?: ReactRenderHandlers;
  /**
   * Called with a state path and its new value when a view writes a bound
   * prop or a binding's follow-up sets state. `state` stays yours: apply the
   * change and pass the new state back. Without it nothing is written.
   */
  readonly onStateChange?: (path: string, value: RenderValue) => void;
  readonly loading?: boolean;
  readonly fallback?: ComponentType<RenderViewProps>;
}
