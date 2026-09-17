# @threadplane/telemetry

Explicit capture helpers and automatic development runtime collection for
applications built with [Threadplane](https://github.com/cacheplane/threadplane),
the open-source thread-plane for agents. The automatic path starts only when a
supported development integration is used, as described below.

<p align="center">
  <a href="https://www.npmjs.com/package/@threadplane/telemetry">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Ftelemetry?color=6C8EFF&labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://angular.dev">
    <img alt="Angular 20 | 21 | 22" src="https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
</p>

## How sending works

- **No install lifecycle scripts.** The manifest declares none, so `npm install`
  runs no code from this package.
- **The legacy browser service starts disabled.** It sends nothing until an application
  calls `provideThreadplaneTelemetry({ enabled: true })`.
- **Node capture is explicit.** An event is sent only where application code
  calls a capture helper.
- **Disable controls win.** `TPLANE_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, CI
  detection, or `disableTelemetry()` prevent explicit Node helper sends before a network call.
- **Point it anywhere.** `TPLANE_TELEMETRY_INGEST_URL`, or an `endpoint` or
  `sink` on the browser provider, routes explicit helper events to infrastructure you control.

The event categories, purposes, and retention that apply to Threadplane's own
properties are described at
[threadplane.ai/privacy](https://threadplane.ai/privacy).

The automatic install collector embedded in `@threadplane/chat`, `@threadplane/langgraph`,
`@threadplane/ag-ui`, and `@threadplane/render` is a separate collection path. It can
include configured Git name/full email and repository-owner hints, including CI;
see the package READMEs and [Privacy](https://threadplane.ai/privacy). This package
retains its own inert install and explicit helper behavior.

## Automatic development runtime collection

LangGraph and AG-UI adapters and the supported JSON renderer use this package's lazy
development collector when they are constructed and used. Angular's `isDevMode()` must
be true and browser APIs must be available before identity/storage/network work.
Production builds, SSR, imports, and automated browsers reporting `navigator.webdriver`
are inert. Creating an agent (or a render element) in a development-mode browser reports
one session start per integration per session; milestones are reported only when the
runtime is actually used. A development build served on a remote hostname is still
development software.

Events contain random event IDs, a browser-origin UUID, an inactivity session UUID,
package/version, integration, timestamps, closed progress milestones, and an optional
opaque installation token from that integration's own package. The token contains no
email or Git metadata. Successful
completion can include a broad duration bucket. No conversation content, endpoint,
thread/run ID, URL, Git identity, or account result is included. The browser-origin
identity is not a verified person, repository, or account.

The browser UUID and 30-minute inactivity session use localStorage where available;
storage failure falls back to page memory and reports the identity's scope.
Milestones deduplicate per integration/session. Immutable initialization envelopes
survive reloads, so an active session can fetch announcements without new milestone
claims. Changing a package version or installation token within a session starts a
new initialization envelope and event ID, including same-version reinstalls. Old
pending/replayed envelopes retain their original token. Milestone deduplication is
unchanged.

Published adapter packages ship a null `./development-install` export. An enabled
non-CI install atomically replaces it with a random package-local UUID, registers the
same token in the install observation, and never puts install identity into browser
code. Angular production builds remove the token. CI and disabled lifecycle runs
first reset prior state to null. Read-only or copied packages may retain an older
token if reset fails; skipped scripts leave the file unchanged. This correlation is
not proof of a unique developer or installation. Browser opt-outs remain effective
independently of the package file.

The credential-free HTTPS POST goes to `https://threadplane.ai/api/growth/collect/v1/runtime`.
Durable acknowledgments are independent of console display. There is an initial exchange,
at most one active refresh per five minutes, and coalesced milestones with at least ten
seconds between requests. The collector caps work at 50 pending events, 20 per request,
24 hours of age, three attempts, and a three-second request/response deadline.
It respects server Retry-After, never polls while idle, and does not promise delivery
on unload. Expired/overflow/exhausted events are discarded with aggregate local counters.

Code-owned announcements have package/version applicability and expiry; they display
as plain console text at most once per stored identity (best effort across browsers/tabs),
with optional approved documentation links. No HTML or remote code executes. A display,
link click, login, or registration is not required for acknowledgment or attribution.

Disable from application bootstrap, before constructing adapters or render trees:

```ts
import { setDevelopmentCollectionEnabled } from '@threadplane/telemetry/browser';
setDevelopmentCollectionEnabled(false);
```

Or run in the browser console before starting the runtime:

```js
localStorage.setItem('THREADPLANE_TELEMETRY_DISABLED', '1');
// Reload the page to stop any request already in flight.
```

`window.__THREADPLANE_TELEMETRY_DISABLED__ = true` is also checked at use/send time.
Programmatic disable immediately aborts pending requests and clears queued work.
Remove the storage/window override and call `setDevelopmentCollectionEnabled(true)`
to enable subsequent use again. Node environment variables do not configure a compiled
browser app.

Adapter `telemetry: false` disables collection. A supplied custom sink replaces the
automatic destination and retains its existing lifecycle callback contract. Chat passes
that choice to nested JSON renderers; an unknown app-owned agent defaults to no automatic
collection in its chat subtree. Standalone render supports `provideRender({ telemetry: false })`
and `<render-spec [telemetry]="false" ... />`. A child cannot override a disabled parent.

Use `getDevelopmentCollectionDiagnostics()` for page-local aggregate acknowledged,
failure, discarded, and pending counts. It returns no identifiers or event content.
A usable install email can qualify for the generic founder hello after its first
linked development activation, without a claim click or lead form. This is a narrow
eligibility path, not verified email ownership or account membership; unsubscribe,
reply, bounce, and suppression controls still apply. Runtime evidence alone does not
approve a contact. Generic AG-UI has
no verified prior-history restoration signal; it does not claim `thread.persisted`.

## Install

```bash
npm install @threadplane/telemetry
```

Both peer dependencies are optional:

```text
@angular/core    ^20.0.0 || ^21.0.0 || ^22.0.0   # required only for the ./browser Angular service
posthog-js       ^1.372.0                             # required only when using PostHog capture
```

## Node usage

Capture only the events your application chooses:

```ts
import { captureEvent } from '@threadplane/telemetry/node';

await captureEvent('tplane:runtime_instance_created', {
  transport: 'langgraph',
});
```

The runtime adapter helpers exported from `@threadplane/telemetry/node` are
convenience wrappers around the same explicit capture path.

The Node capture path and Threadplane's public ingest endpoint validate the seven
documented SDK event names at runtime. Runtime events require `transport`;
`tplane:browser_chat_init` requires `surface`. Property bags must be plain objects.
Only `transport`, `surface`, `requestType`, `provider`, `model`, `errorClass`,
`angularVersion`, `durationMs`, and `sample_weight` are forwarded. Strings are
nonempty labels of at most 128 characters without control characters; durations
must be finite numbers from 0 to 86,400,000 milliseconds, and sampling weights
must be finite numbers of at least 1, preserving reciprocal weights at low sample
rates. Unknown properties are dropped; invalid known metadata
rejects the event. Do not put user content or credentials in metadata labels.
Public submissions are untrusted observations, not verified product activity.

`captureEvent()` returns `{ sent: false, reason: 'invalid' }` for invalid inputs.
The Node stream helpers accept an optional `transport`; valid legacy calls with
provider/model but no transport report `unknown`, without guessing an adapter.
Pass the transport explicitly for meaningful transport breakdowns. Generic
`captureEvent()` calls do not receive this fallback. These checks do not change
browser opt-in, custom sinks, or development-only Growth collection controls.

Set `TPLANE_TELEMETRY_INGEST_URL` to route events to an endpoint you control.
The default endpoint is `https://threadplane.ai/api/ingest`.

## Browser usage

```ts
import { provideThreadplaneTelemetry } from '@threadplane/telemetry/browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideThreadplaneTelemetry({
      enabled: true,
      endpoint: '/api/telemetry',
    }),
  ],
};
```

You can also provide a `sink` callback to use your own analytics client. If the
provider is not enabled, browser helpers do nothing.

## Disable controls

Set either `TPLANE_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`, or call:

```ts
import { disableTelemetry } from '@threadplane/telemetry/node';

disableTelemetry();
```

Common CI environment variables are treated as disabled. Sampling can be set
with `TPLANE_TELEMETRY_SAMPLE_RATE`.

## Anonymous identifiers

- Node identifiers are per-process UUIDs and are not persisted.
- Browser identifiers are per-service-instance UUIDs and are not written to
  cookies or local storage.

## License

MIT. See [LICENSE](../../LICENSE).
