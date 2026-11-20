# @threadplane/cockpit-telemetry

Private Nx library. **Not** part of the publishable `@threadplane/*` group — it is consumed by the 40 Angular examples in the Cockpit capability registry.

## What it does

Both the production `main.ts` and local `main.cockpit.ts` entry points call `bootstrapWithCockpitHarness`. When the parent Cockpit shell embeds an example as an iframe, it appends URL params (`cockpit_did`, `cockpit_phk`, `cockpit_cap`, optional `cockpit_host`). The helper:

1. Installs the runtime readiness bridge before Angular bootstrap starts.
2. Reads those params via `readCockpitConfigFromIframe()`.
3. If present, lazy-loads `provideCockpitTelemetry(config)`; the service initializes PostHog with memory persistence and the parent-provided `distinct_id`.
4. Subscribes to optional `CHAT_LIFECYCLE`, `AGENT_LIFECYCLE`, and `RENDER_LIFECYCLE` signals from `@threadplane/chat`, `@threadplane/angular`, and `@threadplane/render` and emits `cockpit:*` events.
5. Reports Ready only after Angular bootstrap succeeds, or reports `bootstrap_failed` before rethrowing the original bootstrap error.

`bootstrapWithCockpitHarness` owns the page's single Angular bootstrap. Call it once from the entry point; repeated calls would install repeated runtime bridge listeners.

## No app telemetry by default

The framework ships with **zero telemetry** in user apps. Cockpit examples always install the small runtime readiness bridge, but the PostHog provider loads only when all required Cockpit URL params are present. Without those params, the app does not load `posthog-js`. The harness and browser-silence specs enforce this contract.

See `libs/telemetry/README.md` for the parallel pattern in the public telemetry library.
