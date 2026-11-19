import type { ComponentType, ReactNode } from 'react';
import type { UIElement } from '@json-render/core';
import type { DeepReadonly } from '@threadplane/core';

/** Readonly element definition with component type, unresolved props, children, visibility, repeat configuration, and event bindings. */
export type RenderElementData = DeepReadonly<
  Pick<UIElement, 'type' | 'props' | 'children' | 'visible' | 'repeat' | 'on'>
>;
/** Caller-prepared tree identified by a root key, a record of keyed element definitions, and optional initial state. */
export interface RenderSpecData {
  readonly root: string;
  readonly elements: Readonly<Record<string, RenderElementData>>;
  /**
   * Initial state carried by the spec. When `RenderSpec` receives neither `state` nor `store`, it
   * seeds a store of its own from this the first time it appears, so bound inputs can write. The
   * tree keeps that store across later specs; pass `store` to own or reset it yourself.
   */
  readonly state?: Readonly<Record<string, RenderValue>>;
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
/** Resolved component props, binding paths, rendered children, element/loading metadata, and the element's interaction channel. */
export interface RenderViewProps {
  readonly props: Readonly<Record<string, RenderValue>>;
  readonly bindings?: Readonly<Record<string, string>>;
  readonly children?: ReactNode;
  readonly elementKey: string;
  readonly loading?: boolean;
  /**
   * Fires the element's `on[event]` bindings, such as `emit('press')` for a button. The payload is
   * plain data merged over the binding's resolved params; call `event.preventDefault()` yourself.
   * Undefined for a readiness fallback.
   */
  readonly emit?: (
    event: string,
    payload?: Readonly<Record<string, RenderValue>>
  ) => void;
  /**
   * Writes a value at a state path, usually one from `bindings`. Present only when `RenderSpec`
   * was given a `store`; without one, the tree is read-only.
   */
  readonly set?: (path: string, value: RenderValue) => void;
  /** Reports a value this view produced, such as a choice, as a `result` event for this element. */
  readonly result?: (value: RenderValue) => void;
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
/** An application action a spec can name in an element's `on` bindings; params are owned and frozen. */
export type RenderActionHandler = (
  params: Readonly<Record<string, RenderValue>>
) => unknown;
/** Named actions a spec may dispatch. A binding naming an action that is not here does nothing. */
export type ReactRenderHandlers = Readonly<Record<string, RenderActionHandler>>;
/**
 * A writable state owner, such as `createRenderState()` from `@threadplane/content/render-state`.
 * `RenderSpec` reads its snapshot, re-renders when it changes, and writes view edits through `set`.
 */
export interface RenderStore {
  readonly getSnapshot: () => DeepReadonly<Record<string, unknown>>;
  readonly set: (path: string, value: RenderValue) => void;
  readonly subscribe: (notify: () => void) => () => void;
  /** The last write, so a `stateChange` event can name its path; the root otherwise. */
  readonly lastChange?: () =>
    | { readonly path: string; readonly value: unknown }
    | undefined;
}
/** An action ran: its name, the params it received, and what it returned (resolved, for a promise). */
export interface RenderHandlerEvent {
  readonly type: 'handler';
  readonly action: string;
  readonly params: Readonly<Record<string, RenderValue>>;
  readonly result?: unknown;
}
/** The store changed: the written path, its value, and the whole snapshot. */
export interface RenderStateChangeEvent {
  readonly type: 'stateChange';
  readonly path: string;
  readonly value: unknown;
  readonly snapshot: DeepReadonly<Record<string, unknown>>;
}
/** A view reported a value through `result`. */
export interface RenderResultEvent {
  readonly type: 'result';
  readonly value: RenderValue;
  readonly elementKey: string;
}
/**
 * The tree or one of its elements mounted or was removed. An element mounts when its view renders,
 * so a hidden element mounts once it becomes visible; elements report before the tree that holds
 * them, because React mounts children first.
 */
export interface RenderLifecycleEvent {
  readonly type: 'lifecycle';
  readonly event: 'mounted' | 'destroyed';
  readonly scope: 'spec' | 'element';
  readonly elementKey?: string;
  readonly elementType?: string;
}
/** What `onEvent` receives. */
export type RenderEvent =
  | RenderHandlerEvent
  | RenderStateChangeEvent
  | RenderLifecycleEvent
  | RenderResultEvent;
interface RenderSpecBaseProps {
  readonly spec: RenderSpecData | null;
  readonly registry: ReactRenderRegistry;
  readonly functions?: ReactRenderFunctions;
  readonly loading?: boolean;
  /** Renders an element whose type the registry does not name. Without it, such elements are left out. */
  readonly fallback?: ComponentType<RenderViewProps>;
  /**
   * Shown in place of a registered component while any of the element's resolved props is
   * undefined, such as a state path that has not arrived. Once the props resolve, the component
   * mounts and stays mounted for that element. Defaults to `RenderPendingFallback`; `null` mounts
   * every component at once. A readiness entry decides for itself and uses its own `fallback`.
   */
  readonly pendingFallback?: ComponentType<RenderViewProps> | null;
  /** Actions the spec's `on` bindings may run. Without them, events do nothing. */
  readonly handlers?: ReactRenderHandlers;
  /** Notified when an action runs, the store changes, or a view reports a result. */
  readonly onEvent?: (event: RenderEvent) => void;
}
/** Supplies a nullable render tree and component registry, read-only `state` or a writable `store`, computed functions and actions, plus loading state and a fallback component. */
export type RenderSpecProps = RenderSpecBaseProps &
  (
    | {
        /** Read-only data; views get no `set`. */
        readonly state?: DeepReadonly<Record<string, unknown>>;
        readonly store?: undefined;
      }
    | {
        /** A writable owner; views get `set`, and `onSuccess`/`onError` `set` follow-ups write here. */
        readonly store: RenderStore;
        readonly state?: undefined;
      }
  );
