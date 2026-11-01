import type { ComponentType, ReactNode } from 'react';
import type { UIElement } from '@json-render/core';
import type { DeepReadonly } from '@threadplane/core';

/** Readonly element definition with component type, unresolved props, children, visibility, and repeat configuration. */
export type RenderElementData = DeepReadonly<
  Pick<UIElement, 'type' | 'props' | 'children' | 'visible' | 'repeat'>
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
}
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
/** Supplies a nullable render tree, component registry, state and computed functions, plus loading state and a fallback component. */
export interface RenderSpecProps {
  readonly spec: RenderSpecData | null;
  readonly registry: ReactRenderRegistry;
  readonly state?: DeepReadonly<Record<string, unknown>>;
  readonly functions?: ReactRenderFunctions;
  readonly loading?: boolean;
  readonly fallback?: ComponentType<RenderViewProps>;
}
