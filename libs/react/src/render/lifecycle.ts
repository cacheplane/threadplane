import type { RenderEvent } from './types.js';

/** When a rendered tree first mounted, how often its parts mounted, and when state and actions last moved. */
export interface RenderLifecycleSnapshot {
  /** The first mount seen. It does not reset. */
  readonly firstMountAt: {
    readonly kind: 'spec' | 'element';
    readonly elementType?: string;
    readonly at: number;
  } | null;
  /** Every spec and element mount seen. */
  readonly mountCount: number;
  /** Epoch milliseconds of the latest mount. */
  readonly lastMountAt: number | null;
  /** Epoch milliseconds of the latest store write. */
  readonly lastStateChangeAt: number | null;
  /** The latest action reported, and when. */
  readonly lastHandlerInvokedAt: {
    readonly action: string;
    readonly at: number;
  } | null;
}

/**
 * Measurements gathered from `RenderSpec` events. Pass `onEvent` to one or more trees, and read the
 * snapshot with `useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot)`.
 */
export interface RenderLifecycle {
  readonly onEvent: (event: RenderEvent) => void;
  readonly getSnapshot: () => RenderLifecycleSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

const INITIAL: RenderLifecycleSnapshot = Object.freeze({
  firstMountAt: null,
  mountCount: 0,
  lastMountAt: null,
  lastStateChangeAt: null,
  lastHandlerInvokedAt: null,
});

/** Creates a lifecycle recorder that turns `RenderSpec` events into timing measurements. */
export function createRenderLifecycle(): RenderLifecycle {
  let snapshot = INITIAL;
  const listeners = new Set<() => void>();
  const update = (next: Partial<RenderLifecycleSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...next });
    for (const listener of [...listeners]) listener();
  };
  return Object.freeze({
    onEvent(event: RenderEvent) {
      const at = Date.now();
      if (event.type === 'lifecycle') {
        if (event.event !== 'mounted') return;
        update({
          firstMountAt:
            snapshot.firstMountAt ??
            Object.freeze(
              event.elementType === undefined
                ? { kind: event.scope, at }
                : { kind: event.scope, elementType: event.elementType, at }
            ),
          mountCount: snapshot.mountCount + 1,
          lastMountAt: at,
        });
      } else if (event.type === 'stateChange') {
        update({ lastStateChangeAt: at });
      } else if (event.type === 'handler') {
        update({
          lastHandlerInvokedAt: Object.freeze({ action: event.action, at }),
        });
      }
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}
