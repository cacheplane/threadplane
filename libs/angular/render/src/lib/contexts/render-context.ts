import { InjectionToken } from '@angular/core';
import type { StateStore, ComputedFunction } from '@json-render/core';
import type { AngularRegistry } from '../render.types';
import type { RenderEvent } from '../render-event';

/** Shared render-tree dependencies supplied to elements: registry, state store, computed functions, action handlers, and event callback. */
export interface RenderContext {
  registry: AngularRegistry;
  store: StateStore;
  functions?: Record<string, ComputedFunction>;
  handlers?: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>;
  emitEvent?: (event: RenderEvent) => void;
  loading?: boolean;
}

/** Injection token through which a render spec supplies its current context to descendant elements. */
export const RENDER_CONTEXT = new InjectionToken<RenderContext>('RENDER_CONTEXT');
