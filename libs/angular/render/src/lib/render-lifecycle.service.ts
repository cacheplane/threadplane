import { Injectable, signal } from '@angular/core';
import type { RenderLifecycle } from './lifecycle';

/**
 * Provided by `provideRender()` — opt-in. Scope follows the consumer's
 * `provideRender` call (root-scoped by default, sub-tree if `provideRender`
 * is in a sub-injector).
 */
@Injectable()
export class RenderLifecycleService implements RenderLifecycle {
  private _firstMountAt = signal<{ kind: 'spec' | 'element'; elementType?: string; at: number } | null>(null);
  private _mountCount = signal(0);
  private _lastMountAt = signal<number | null>(null);
  private _lastStateChangeAt = signal<number | null>(null);
  private _lastHandlerInvokedAt = signal<{ action: string; at: number } | null>(null);

  readonly firstMountAt = this._firstMountAt.asReadonly();
  readonly mountCount = this._mountCount.asReadonly();
  readonly lastMountAt = this._lastMountAt.asReadonly();
  readonly lastStateChangeAt = this._lastStateChangeAt.asReadonly();
  readonly lastHandlerInvokedAt = this._lastHandlerInvokedAt.asReadonly();

  notifyLifecycle(event: { kind: 'spec' | 'element'; type: 'mounted' | 'destroyed'; elementType?: string }): void {
    if (event.type === 'mounted') {
      const now = Date.now();
      if (this._firstMountAt() === null) {
        this._firstMountAt.set({ kind: event.kind, elementType: event.elementType, at: now });
      }
      this._mountCount.update((c) => c + 1);
      this._lastMountAt.set(now);
    }
  }

  notifyStateChange(): void {
    this._lastStateChangeAt.set(Date.now());
  }

  notifyHandlerInvoked(action: string): void {
    this._lastHandlerInvokedAt.set({ action, at: Date.now() });
  }
}
