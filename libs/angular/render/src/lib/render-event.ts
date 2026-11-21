/** Render notification identifying an invoked action, its parameters, and the result observed by the handler wrapper. */
export interface RenderHandlerEvent {
  readonly type: 'handler';
  readonly action: string;
  readonly params: Record<string, unknown>;
  readonly result?: unknown;
}

/** Render notification containing a changed state path, its new value, and the store snapshot. */
export interface RenderStateChangeEvent {
  readonly type: 'stateChange';
  readonly path: string;
  readonly value: unknown;
  readonly snapshot: Record<string, unknown>;
}

/** Mount or destruction notification for a render spec or element, with optional element identity. */
export interface RenderLifecycleEvent {
  readonly type: 'lifecycle';
  readonly event: 'mounted' | 'destroyed';
  readonly scope: 'spec' | 'element';
  readonly elementKey?: string;
  readonly elementType?: string;
}

/** Value announced by a mounted view through its render host, optionally associated with an element key. */
export interface RenderResultEvent {
  readonly type: 'result';
  readonly value: unknown;
  readonly elementKey?: string;
}

/** Union of action, state-change, lifecycle, and component-result notifications emitted by the render engine. */
export type RenderEvent =
  | RenderHandlerEvent
  | RenderStateChangeEvent
  | RenderLifecycleEvent
  | RenderResultEvent;
