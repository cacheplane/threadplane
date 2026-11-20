import {
  ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideThreadplaneTelemetry } from '@threadplane/telemetry/browser';
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/ag-ui';
import { type } from '@threadplane/core';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { ItineraryStore } from './itinerary-store';
import {
  ITINERARY_AGENT,
  ItineraryRunState,
  withRunState,
  type ItineraryState,
} from './client-tools';
import { GoogleMapsLoader } from './google-maps-loader';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideThreadplaneTelemetry(environment.telemetry),
    // Thread persistence intentionally omitted: the itinerary AG-UI server
    // uses an in-process MemorySaver (examples/ag-ui/python/src/server.py)
    // that is wiped on every server restart, so restoring by threadId would
    // not return prior conversation history. Additionally, the AG-UI protocol
    // sends the full client-side message list with every run, meaning the
    // session constructs each turn from what the client already holds —
    // there is no server-side "snapshot replay on connect" for this transport.
    // Standalone LangGraph apps backed by a durable checkpointer use
    // injectThreadRouting (see examples/chat); for AG-UI to adopt it the server
    // would need a persistent store (e.g. SqliteSaver / PostgresSaver) so
    // reloading a prior threadId actually returns prior history.
    //
    // Typed agent provider: flows the session type through DI so every
    // injectAgent(ITINERARY_AGENT) call returns Agent<ItinerarySession>.
    // `interruptTransport: 'auto'` answers the bridge's CUSTOM on_interrupt
    // notice through forwardedProps.command.resume. `withRunState` merges the
    // shell's palette knobs into the state of every run.
    provideAgent(ITINERARY_AGENT, () => {
      const runState = inject(ItineraryRunState);
      return {
        createSession: (context) =>
          withRunState(
            createSession({
              url: environment.agentUrl,
              // The session names a new conversation's thread and reports
              // it, so agent.threadId() is set with no code here.
              threadId: context.threadId,
              onThreadId: context.onThreadId,
              reportOperationFailure: context.reportOperationFailure,
              developmentRuntime: context.developmentRuntime,
              stateType: type<ItineraryState>(),
              interruptTransport: 'auto',
            }),
            () => runState.read(),
          ),
      };
    }),
    // Eagerly load the Google Maps JS API at bootstrap via the loader service,
    // which owns the single `loaded` signal the map canvas gates its
    // <google-map> on. Loading early lets the GeocodingService work before App
    // mode is opened; the map still waits for `loaded()` so its component never
    // constructs before the API is present. Skips cleanly with no key.
    provideEnvironmentInitializer(() => inject(GoogleMapsLoader).ensureLoaded()),
    // The frontend-owned itinerary is a single shared instance: the panel,
    // the App component, and the client-tool ask component all inject it, so
    // user edits and agent writes hit the same signals and render live.
    ItineraryStore,
  ],
};
