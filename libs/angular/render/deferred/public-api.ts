// What `@threadplane/angular/chat` loads on demand to render a spec: the
// renderer without its telemetry bridge, and nothing else.
//
// A deferred import keeps every export of its target module, so loading
// `@threadplane/angular/render` itself would keep `RenderSpecComponent`'s
// bridge and, with it, telemetry's development runtime in every chat app's
// initial bundle, including apps that never render a spec. This entry point
// names one export, so only the renderer is kept.
export { ɵRenderSpecCore } from '@threadplane/angular/render';
