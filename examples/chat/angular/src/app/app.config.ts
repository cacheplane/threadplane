import {
  ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideThreadplaneTelemetry } from '@threadplane/telemetry/browser';
import { AGENT_CLIENT_OPTIONS, provideThreadDirectory } from '@threadplane/angular';
import { e2eClientOptions } from './shell/e2e-overrides';
import { demoThreadDirectoryConfig } from './shell/demo-threads';
import { ItineraryStore } from './itinerary-store';
import { GoogleMapsLoader } from './google-maps-loader';
import { routes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideThreadplaneTelemetry(environment.telemetry),
    // Single source of truth for the SDK client options — every agent's session
    // and the thread directory receive this as `context.clientOptions`.
    // Production: e2eClientOptions() returns undefined → the session's own
    // default (no retries). Under e2e: the THREADPLANE_E2E_MAX_RETRIES
    // localStorage flag states the budget. useFactory runs at injection time
    // (post-bootstrap), so the flag is readable.
    { provide: AGENT_CLIENT_OPTIONS, useFactory: () => e2eClientOptions() },
    // The saved conversations the shell lists, searches and validates thread
    // URLs against. The agents themselves are provided by the routed
    // components that own them (DemoShell, the hero and the stage).
    provideThreadDirectory(demoThreadDirectoryConfig),
    // App-wide singleton so DemoShell, the itinerary panel, and the map cockpit
    // all read/write ONE working copy of the itinerary. Provided at root (not at
    // the component) so routed children share the same instance.
    ItineraryStore,
    // Eagerly kick off the Google Maps JS API load at bootstrap so the map
    // canvas can mount as soon as App mode turns on (no per-component wait).
    provideEnvironmentInitializer(() => inject(GoogleMapsLoader).ensureLoaded()),
  ],
};
