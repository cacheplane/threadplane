// The part of the render engine that does not render: view registries, the
// signal state store, the fallback component and the devtools hook. It holds
// no json-render runtime, so code that only builds registries (the chat UI's
// markdown and tool views, for example) can import it eagerly and leave the
// renderer, `@threadplane/angular/render`, to load when a spec first renders.
// `@threadplane/angular/render` re-exports all of it.

// Types
export type {
  AngularComponentInputs,
  AngularComponentRenderer,
  AngularRegistry,
  RenderConfig,
  RenderViewEntry,
  NormalizedEntry,
} from './src/render.types';
export type {
  StandardSchemaV1,
  StandardSchemaInferInput,
  StandardSchemaInferOutput,
} from './src/standard-schema';

// Registry
export { defineAngularRegistry } from './src/define-angular-registry';

// State
export { signalStateStore } from './src/signal-state-store';
export type { SignalStateStore, StateChangeRecord } from './src/signal-state-store';

// Views
export { views, withViews, overrideViews, withoutViews, toRenderRegistry } from './src/views';
export type { ViewRegistry } from './src/views';

// Fallback
export { DefaultFallbackComponent } from './src/default-fallback.component';

// Development-only devtools hook: `@threadplane/angular/chat` provides it to report
// which spec elements mounted, fell back, did not resolve, or did not render.
export { ɵRENDER_DEVTOOLS } from './src/devtools/render-devtools';
export type {
  RenderDevtoolsHook as ɵRenderDevtoolsHook,
  RenderResolution as ɵRenderResolution,
  RenderResolvedElement as ɵRenderResolvedElement,
  RenderElementState as ɵRenderElementState,
} from './src/devtools/render-devtools';
// Internal: the renderer's own devtools wiring, shared so it is one instance.
export {
  RENDER_DEVTOOLS_TRACKER as ɵRENDER_DEVTOOLS_TRACKER,
  createRenderDevtoolsTracker as ɵcreateRenderDevtoolsTracker,
  resolveRenderTree as ɵresolveRenderTree,
  elementDevtoolsState as ɵelementDevtoolsState,
  connectRenderDevtools as ɵconnectRenderDevtools,
} from './src/devtools/render-devtools';
export type {
  RenderElementRegistration as ɵRenderElementRegistration,
  RenderDevtoolsTracker as ɵRenderDevtoolsTracker,
  RenderElementView as ɵRenderElementView,
} from './src/devtools/render-devtools';
