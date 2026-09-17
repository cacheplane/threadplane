# @threadplane/render

The generative-UI render engine of [Threadplane](https://github.com/cacheplane/threadplane), the open-source thread-plane for agents. `@json-render/core`-backed: it maps a JSON spec to Angular components through a registry you define, so agent-generated UI can only render the design-system components you registered. `@threadplane/chat` uses it for generative UI.

<p>
  <a href="https://www.npmjs.com/package/@threadplane/render">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Frender?color=6C8EFF&labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://angular.dev">
    <img alt="Angular 20 | 21 | 22" src="https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
  <a href="../../LICENSE">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
</p>

## What it does

- Renders a JSON spec tree to Angular components via a named view registry (`<render-spec>`) or a single node (`<render-element>`).
- Registry composition utilities (`views`, `withViews`, `overrideViews`, `withoutViews`) let you build, extend, replace, and trim registries without mutation.
- Signal-based state store (`signalStateStore`) and per-component fallback support keep UI consistent during streaming.

## Install

```bash
npm install @threadplane/render @json-render/core
```

**Peer dependencies:** `@angular/core ^20.0.0 || ^21.0.0 || ^22.0.0`, `@angular/common ^20.0.0 || ^21.0.0 || ^22.0.0`, `@json-render/core ^0.16.0`

`@json-render/core` supplies the spec types and evaluation engine that `@threadplane/render` adapts to Angular.

## Quick start

**1. Define your view registry and provide it.**

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRender, provideViews, views, toRenderRegistry } from '@threadplane/render';
import { CardComponent } from './card.component';
import { HeroComponent } from './hero.component';

const myRegistry = toRenderRegistry(
  views({ card: CardComponent, hero: HeroComponent })
);

export const appConfig: ApplicationConfig = {
  providers: [
    provideRender({ registry: myRegistry }),
  ],
};
```

**2. Render a spec in your component.**

```typescript
import { Component, signal } from '@angular/core';
import { RenderSpecComponent } from '@threadplane/render';
import type { Spec } from '@json-render/core';

@Component({
  selector: 'app-agent-ui',
  imports: [RenderSpecComponent],
  template: `<render-spec [spec]="spec()" />`,
})
export class AgentUiComponent {
  spec = signal<Spec | null>(null);

  onAgentMessage(incoming: Spec) {
    this.spec.set(incoming);
  }
}
```

## Capabilities

**View registry composition** — `views(map)` creates a frozen registry; `withViews(base, additions)` adds NEW keys without touching existing entries — use it to extend a registry with previously-unhandled node types; `overrideViews(base, overrides)` replaces matching keys so overrides win over base — use it to swap an existing renderer; `withoutViews(base, ...keys)` prunes entries. Convert to an `AngularRegistry` with `toRenderRegistry` and supply it app-wide via `provideRender({ registry })`, or pass one directly as the `[registry]` input on `<render-spec>` / `<render-element>`.

**Signal state store** — `signalStateStore(initialState?)` provides a `StateStore` backed by Angular Signals, suitable for two-way bindings declared in a spec.

**DI providers** — `provideRender(config)` registers `RenderConfig` (registry, store, functions, handlers) as environment-scoped defaults read by the render components; `provideViews(registry)` publishes a `ViewRegistry` under the `VIEW_REGISTRY` token. `<render-spec>` and `<render-element>` resolve their registry in priority order: the `[registry]` template input, then `RENDER_CONFIG.registry` (from `provideRender(...)`), then `VIEW_REGISTRY` (from `provideViews(...)`), then the existing empty fallback.

**Fallback** — `DefaultFallbackComponent` renders when no component is registered for a spec node; individual entries in a `ViewRegistry` can supply their own `fallback` component via `RenderViewEntry`.

## Reliability

Powers `@threadplane/chat` generative-UI rendering in production. Patch-only `0.0.x` releases. Validated by the CI job "Library — lint / test / build" on every commit.

## Installation collection

This package includes automatic first-party installation collection, including CI.
It reports the package/version, basic execution environment, a random installation
identifier, configured Git display name and full email, and a recognized repository
hosting provider/owner when available. CI is labeled separately; install counts are
not developer counts, and Git identity is an unverified hint. A usable install email
can qualify for the generic founder hello after a linked development activation;
this does not verify email ownership, employment, or account membership. Existing
unsubscribe, reply, bounce, and suppression controls still apply.

An enabled non-CI install writes a random package-local correlation token to the
`./development-install` export. It contains no email or Git metadata and is separate
from the home installation ID. Published packages contain null; development runtime
events can carry the installed token. Production bundles remove it and do not collect
runtime events. CI alone cannot create an eligible bridge or trigger a hello.

Disabled and CI lifecycle runs first try to reset an earlier token to null. Copied or
cached packages can retain tokens: read-only packages may prevent that reset, and
skipped scripts leave existing files unchanged. A token therefore does not prove a
unique installation or developer. The independent browser opt-out below still stops
runtime transmission, including when a stale token remains.

Set `DO_NOT_TRACK=1` or `TPLANE_TELEMETRY_DISABLED=1` before installing to disable
collection before identity reads, persistence, or network. Package-manager controls
such as `--ignore-scripts` also prevent the hook from running. Installation succeeds
independently of collection, with one request and a five-second execution budget.

The random ID is stored at `~/.threadplane/installation-id` where writable; otherwise
it lasts for one invocation. Git includes, system config, and command/environment
identity overrides are not inspected. Unsupported checkout/configuration layouts,
blocked scripts or network, and reused caches can leave gaps or duplicate identities.
Raw repository URLs/names, local paths, source code, credentials, and application
content are excluded from install reports. See [Privacy](https://threadplane.ai/privacy).

## License

MIT. See [LICENSE](../../LICENSE).

## Development browser collection

Supported LangGraph/AG-UI runtime use and real JSON-render component mounts automatically
report development progress to Threadplane. Angular development mode and browser APIs
are required. Production builds, SSR, imports, and
automated browsers reporting `navigator.webdriver` are inert. Creating an agent (or a render element) in a development-mode browser reports one session start per integration per session; milestones are reported only when the runtime is actually used.
Reports contain package/version, integration, closed milestones, timestamps, a random
browser-origin ID, and a session with a 30-minute inactivity boundary. They exclude
prompts, messages, application state, private URLs, thread/run IDs, and credentials.
The IDs describe an origin/session, not a verified person or repository.

Set adapter `telemetry: false` to disable automatic collection; a custom sink replaces
the automatic destination while preserving its existing callbacks. Chat carries that
choice into nested JSON renderers. Standalone render supports
`provideRender({ telemetry: false })` or `<render-spec [telemetry]="false" ... />`.

For a page-wide control, call `setDevelopmentCollectionEnabled(false)` from
`@threadplane/telemetry/browser` before creating runtimes. From the browser console,
run `localStorage.setItem('THREADPLANE_TELEMETRY_DISABLED', '1')` and reload.
Node environment variables do not configure a compiled browser app.

The credential-free announcement exchange records progress before returning optional
plain-text console announcements. No click or registration is required. It has bounded
queues/retries and a three-second request deadline; collection failures do not affect
application use. A linked eligible install email can receive the generic founder hello;
runtime evidence alone does not approve a contact. See the
[telemetry controls and collection details](https://github.com/cacheplane/threadplane/tree/main/libs/telemetry#automatic-development-runtime-collection)
and [Privacy](https://threadplane.ai/privacy).
