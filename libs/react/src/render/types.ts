import type { ComponentType, ReactNode } from 'react';
import type { UIElement } from '@json-render/core';
import type { DeepReadonly } from '@threadplane/core';

export type RenderElementData = DeepReadonly<
  Pick<UIElement, 'type' | 'props' | 'children' | 'visible' | 'repeat'>
>;
export interface RenderSpecData {
  readonly root: string;
  readonly elements: Readonly<Record<string, RenderElementData>>;
}
export type RenderValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | readonly RenderValue[]
  | { readonly [key: string]: RenderValue };
export interface RenderViewProps {
  readonly props: Readonly<Record<string, RenderValue>>;
  readonly bindings?: Readonly<Record<string, string>>;
  readonly children?: ReactNode;
  readonly elementKey: string;
  readonly loading?: boolean;
}
export type ReactRenderRegistry = Readonly<
  Record<string, ComponentType<RenderViewProps>>
>;
/** A pure synchronous calculation; arguments are owned and recursively frozen. */
export type RenderComputedFunction = (
  args: Readonly<Record<string, RenderValue>>
) => RenderValue;
export type ReactRenderFunctions = Readonly<
  Record<string, RenderComputedFunction>
>;
export interface RenderSpecProps {
  readonly spec: RenderSpecData | null;
  readonly registry: ReactRenderRegistry;
  readonly state?: DeepReadonly<Record<string, unknown>>;
  readonly functions?: ReactRenderFunctions;
  readonly loading?: boolean;
  readonly fallback?: ComponentType<RenderViewProps>;
}
