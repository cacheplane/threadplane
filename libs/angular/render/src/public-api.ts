// The registry, state store, fallback and devtools hook live in
// `@threadplane/angular/render/registry`, which holds no json-render runtime;
// this entry point re-exports them by package name so both share one instance.
// Types
export type {
  AngularComponentInputs,
  AngularComponentRenderer,
  AngularRegistry,
  RenderConfig,
} from '@threadplane/angular/render/registry';
export type {
  StandardSchemaV1,
  StandardSchemaInferInput,
  StandardSchemaInferOutput,
} from '@threadplane/angular/render/registry';

// Contexts
export { RENDER_CONTEXT } from './lib/contexts/render-context';
export type { RenderContext } from './lib/contexts/render-context';
export { REPEAT_SCOPE } from './lib/contexts/repeat-scope';
export type { RepeatScope } from './lib/contexts/repeat-scope';
export { RENDER_HOST, injectRenderHost } from './lib/contexts/render-host';
export type { RenderHost } from './lib/contexts/render-host';

// Registry
export { defineAngularRegistry } from '@threadplane/angular/render/registry';

// State
export { signalStateStore } from '@threadplane/angular/render/registry';
export type { SignalStateStore, StateChangeRecord } from '@threadplane/angular/render/registry';

// Provider
export { provideRender, RENDER_CONFIG } from './lib/provide-render';

// Components
export { RenderElementComponent } from './lib/render-element.component';
export { RenderSpecComponent } from './lib/render-spec.component';
// Internal: the renderer without its telemetry bridge, which chat loads on demand.
export { RenderSpecCore as ɵRenderSpecCore } from './lib/render-spec.component';

// Views
export { views, withViews, overrideViews, withoutViews, toRenderRegistry } from '@threadplane/angular/render/registry';
export type { ViewRegistry } from '@threadplane/angular/render/registry';
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
export { DefaultFallbackComponent } from '@threadplane/angular/render/registry';
export type { RenderViewEntry } from '@threadplane/angular/render/registry';

// Development-only devtools hook: `@threadplane/angular/chat` provides it to report
// which spec elements mounted, fell back, did not resolve, or did not render.
export { ɵRENDER_DEVTOOLS } from '@threadplane/angular/render/registry';
export type {
  ɵRenderDevtoolsHook,
  ɵRenderResolution,
  ɵRenderResolvedElement,
  ɵRenderElementState,
} from '@threadplane/angular/render/registry';
