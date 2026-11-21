import { InjectionToken, Signal } from '@angular/core';

/** Reactive mount, state-change, and handler-invocation measurements for the render lifecycle service. */
export interface RenderLifecycle {
  /** First mount event in this render context. Sticky — does not reset. */
  readonly firstMountAt: Signal<{ kind: 'spec' | 'element'; elementType?: string; at: number } | null>;
  /** Total mount count since render context started. */
  readonly mountCount: Signal<number>;
  /** Epoch ms of the most recent mount event. */
  readonly lastMountAt: Signal<number | null>;
  /** Epoch ms of the most recent state-change event. */
  readonly lastStateChangeAt: Signal<number | null>;
  /** Most recent handler invocation. */
  readonly lastHandlerInvokedAt: Signal<{ action: string; at: number } | null>;
}

/** Injection token exposing render lifecycle measurements through the service registered by provideRender. */
export const RENDER_LIFECYCLE = new InjectionToken<RenderLifecycle>('RENDER_LIFECYCLE');
