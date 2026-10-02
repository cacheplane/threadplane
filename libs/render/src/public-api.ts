// Types
export type {
  AngularComponentInputs,
  AngularComponentRenderer,
  AngularRegistry,
  RenderConfig,
} from './lib/render.types';
export type {
  StandardSchemaV1,
  StandardSchemaInferInput,
  StandardSchemaInferOutput,
} from './lib/standard-schema';

// Contexts
export { RENDER_CONTEXT } from './lib/contexts/render-context';
export type { RenderContext } from './lib/contexts/render-context';
export { REPEAT_SCOPE } from './lib/contexts/repeat-scope';
export type { RepeatScope } from './lib/contexts/repeat-scope';
export { RENDER_HOST, injectRenderHost } from './lib/contexts/render-host';
export type { RenderHost } from './lib/contexts/render-host';

// Registry
export { defineAngularRegistry } from './lib/define-angular-registry';

// State
export { signalStateStore } from './lib/signal-state-store';
export type { SignalStateStore, StateChangeRecord } from './lib/signal-state-store';

// Provider
export { provideRender, RENDER_CONFIG } from './lib/provide-render';

// Components
export { RenderElementComponent } from './lib/render-element.component';
export { RenderSpecComponent } from './lib/render-spec.component';

// Views
export { views, withViews, overrideViews, withoutViews, toRenderRegistry } from './lib/views';
export type { ViewRegistry } from './lib/views';
export { provideViews, VIEW_REGISTRY } from './lib/provide-views';

// Events
export type {
  RenderEvent,
  RenderHandlerEvent,
  RenderStateChangeEvent,
  RenderLifecycleEvent,
  RenderResultEvent,
} from './lib/render-event';

// Lifecycle
export { RENDER_LIFECYCLE } from './lib/lifecycle';
export type { RenderLifecycle } from './lib/lifecycle';

// Fallback
export { DefaultFallbackComponent } from './lib/default-fallback.component';
export type { RenderViewEntry } from './lib/render.types';

// Development-only devtools hook: `@threadplane/chat` provides it to report
// which spec elements mounted, fell back, did not resolve, or did not render.
export { ɵRENDER_DEVTOOLS } from './lib/devtools/render-devtools';
export type {
  RenderDevtoolsHook as ɵRenderDevtoolsHook,
  RenderResolution as ɵRenderResolution,
  RenderResolvedElement as ɵRenderResolvedElement,
  RenderElementState as ɵRenderElementState,
} from './lib/devtools/render-devtools';
