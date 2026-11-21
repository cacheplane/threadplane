import { InjectionToken, inject } from '@angular/core';

/**
 * The element-scoped host a mounted view component talks back through.
 * Agent-agnostic: `result(value)` just means "this component produced a
 * value"; the render lib surfaces it as a RenderResultEvent and never
 * interprets it. Provided per-element by RenderElementComponent, and once
 * per row for a repeating element, so `emit` carries the row that fired it
 * and `{ $item: … }` action params resolve in that row's scope.
 */
export interface RenderHost {
  /** Write a value to the render state store at a JSON-Pointer path. */
  set(path: string, value: unknown): void;
  /** Fire a named event; routed to the element's `on[event]` handlers. */
  emit(event: string, payload?: Record<string, unknown>): void;
  /** Announce this component's result value (e.g. a HITL submission). */
  result(value: unknown): void;
}

/** Injection token for the element-scoped state, event, and result bridge used by mounted view components. */
export const RENDER_HOST = new InjectionToken<RenderHost>('RENDER_HOST');

/**
 * Obtain the element-scoped {@link RenderHost} from inside a mounted view
 * component — use it to write state, emit events, or announce a result back to
 * the render engine.
 *
 * @example
 * ```ts
 * \@Component({ ... })
 * class ApproveButton {
 *   private host = injectRenderHost();
 *   approve() { this.host.result('approved'); }
 * }
 * ```
 */
export function injectRenderHost(): RenderHost {
  return inject(RENDER_HOST);
}
