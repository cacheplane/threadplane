import { InjectionToken } from '@angular/core';
import type {
  DevelopmentRuntime,
  DevelopmentRuntimeOptions,
} from '@threadplane/telemetry/browser/development';

/**
 * How a render tree reaches telemetry's development runtime. The renderer
 * never imports the telemetry package itself: `RenderSpecComponent` provides
 * this bridge, and so does `@threadplane/angular/chat`'s generative UI, which
 * loads the renderer on demand. An application that never renders a spec then
 * ships none of the runtime, even though its bundle holds the deferred
 * renderer chunk.
 */
export interface RenderTelemetry {
  /** The development collection policy of the tree around the spec, if any. */
  readonly policy: (() => boolean) | null;
  /** Telemetry's `createDevelopmentRuntime`. */
  readonly createRuntime: (options: DevelopmentRuntimeOptions) => DevelopmentRuntime;
}

/** The telemetry bridge of the nearest spec host. */
export const RENDER_TELEMETRY = new InjectionToken<RenderTelemetry>('ɵRENDER_TELEMETRY');

/**
 * The collection policy of a render tree: the surrounding policy, the spec's
 * `telemetry` input and `provideRender({ telemetry })`, combined.
 */
export const RENDER_COLLECTION_POLICY = new InjectionToken<() => boolean>('ɵRENDER_COLLECTION_POLICY');
