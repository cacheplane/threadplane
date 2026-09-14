# @threadplane/ag-ui

The AG-UI adapter for [Threadplane](https://github.com/cacheplane/threadplane), the open-source thread-plane for agents. Wraps an [AG-UI](https://github.com/ag-ui-protocol/ag-ui) `AbstractAgent` into the runtime-neutral `Agent` contract that `@threadplane/chat` consumes, so any AG-UI-compatible backend drives the same chat surface.

<p align="center">
  <a href="https://www.npmjs.com/package/@threadplane/ag-ui">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Fag-ui?color=6C8EFF&labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://angular.dev">
    <img alt="Angular 20 | 21 | 22" src="https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
  <a href="../../LICENSE">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
</p>

Part of [Threadplane](https://github.com/cacheplane/threadplane).

> Talking to LangGraph Platform directly? See [`@threadplane/langgraph`](https://www.npmjs.com/package/@threadplane/langgraph) — same API shape, LangGraph SDK underneath.

---

## What it does

- Bridges any AG-UI-compatible backend into the Threadplane chat surface via `toAgent()`.
- Supports AG-UI-compatible runtimes including LangGraph, CrewAI, Mastra, Microsoft Agent Framework, AG2, Pydantic AI, and AWS Strands.
- Exposes messages, status, tool calls, and raw AG-UI state as Angular Signals, plus `submit()`/`stop()`/`regenerate()` actions — coverage depends on what the AG-UI backend emits.
- Ships `FakeAgent` and `provideFakeAgent` test doubles for unit testing without a live backend.

---

## Install

```bash
npm install @threadplane/chat @threadplane/ag-ui @ag-ui/client @ag-ui/core marked
```

**Peer dependencies:** `@threadplane/chat: *`, `@angular/core: ^20.0.0 || ^21.0.0 || ^22.0.0`, `@ag-ui/client: *`, `@ag-ui/core: *`, `rxjs: ~7.8.0`

`marked` is the required markdown parser peer used by `@threadplane/chat` when you render assistant messages through `<chat>`.

---

## Quick start

Register the agent in your `ApplicationConfig`, then inject it into a component and bind it to `<chat>`.

```ts
// app.config.ts
import { provideAgent } from '@threadplane/ag-ui';

export const appConfig: ApplicationConfig = {
  providers: [provideAgent({ url: 'https://your.agent.endpoint' })],
};
```

```ts
// app.component.ts
import { Component } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';

@Component({
  imports: [ChatComponent],
  template: `<chat [agent]="agent" />`,
})
export class AppComponent {
  protected readonly agent = injectAgent();
}
```

Both `@threadplane/langgraph` and `@threadplane/ag-ui` expose `provideAgent`/`injectAgent`. Components using the neutral `Agent` contract can share their UI; provider configuration and adapter-specific extensions differ.

---

## Capabilities

`toAgent()` translates AG-UI events into Angular Signals on the runtime-neutral `Agent` contract:

| Signal | Description |
|---|---|
| `messages()` | Chat message history |
| `status()` | `'idle' \| 'running' \| 'error'` |
| `isLoading()` | True while a run is active |
| `toolCalls()` | In-progress and completed tool calls |
| `error()` | Last run error, if any |
| `state()` | Raw AG-UI state snapshot |
| `customEvents()` | Non-`on_interrupt` `CUSTOM` events for live a2ui and app-specific side effects |
| `subagents()` | `ACTIVITY_*` entries with `activityType: 'subagent'`, projected to the neutral subagent contract |
| `clientTools` | Browser client-tool catalog, pending calls, and result resolution used by `<chat [clientTools]>` |

Which capabilities populate depends on the events the AG-UI backend emits. `submit()`, `stop()`, and `regenerate()` are supported.

### Interrupts (human-in-the-loop)

`agent.interrupt()` is a `Signal<AgentInterrupt | undefined>` projected from native `RUN_FINISHED` interrupt outcomes or compatibility `CUSTOM on_interrupt` events. Native batches take display precedence in `auto` and `protocol`; explicit command profiles display the compatibility interrupt. String-serialized compatibility values are JSON-parsed automatically.

Resume with `agent.submit({ resume })`. Select `interruptTransport` in `provideAgent()` to match the backend:

| Profile | Resume transport |
| --- | --- |
| `auto` (default) | Prefers a native batch, including mixed native/compatibility delivery; otherwise detects Mastra correlation data or uses the legacy command. |
| `protocol` | Top-level `resume` entries, one per native interrupt ID. |
| `legacy-command` | `forwardedProps.command.resume`, as used by the LangGraph AG-UI bridge. |
| `mastra-command` | `forwardedProps.command.resume` plus `command.interruptEvent` containing the observed tool-call and run IDs. |

The current Mastra backend requires explicit `mastra-command`: it emits native and compatibility interrupts but consumes the command transport. Native cancellation uses `{ interruptId, status: 'cancelled' }` without a payload; an application's `{ approved: false }` is a resolved decision with backend-defined meaning.

Pair with `<chat-approval-card>` from `@threadplane/chat` for Approve and Cancel controls. This single-decision example uses a backend that expects `{ approved: boolean }`:

```ts
import { Component } from '@angular/core';
import { ChatComponent, ChatApprovalCardComponent } from '@threadplane/chat';
import type { ChatApprovalAction } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';

@Component({
  imports: [ChatComponent, ChatApprovalCardComponent],
  template: `
    <chat [agent]="agent" />
    <chat-approval-card
      [agent]="agent"
      matchKind="refund_approval"
      (action)="onAction($event)" />
  `,
})
export class App {
  protected readonly agent = injectAgent();
  onAction(action: ChatApprovalAction) {
    if (action === 'edit') return;
    void this.agent.submit({ resume: { approved: action === 'approve' } });
  }
}
```

See `cockpit/ag-ui/interrupts` for a complete working example, and the [LangGraph interrupts guide](https://threadplane.ai/docs/langgraph/guides/interrupts) for that adapter's behavior. Both share `interrupt()` and `submit({ resume })`; AG-UI's `interruptSession`, `ready`, `reconcileInterrupt()`, `dispose()`, `persistence` configuration, and `interruptGeneration` submit option are adapter extensions. Browser persistence cannot restore a lost server checkpoint or prove backend completion.

### Citations

`bridgeCitationsState(thread, messages)` populates `Message.citations` from AG-UI state. Citations live under the `citations` key of the agent state, keyed by message ID (`state.citations[messageId]`).

Example state shape:

```json
{
  "state": {
    "citations": {
      "msg-123": [
        {
          "id": "src1",
          "index": 1,
          "title": "Example Source",
          "url": "https://example.com",
          "snippet": "Relevant excerpt from the source..."
        }
      ]
    }
  }
}
```

Each citation supports `id`, `index`, `title`, `url`, `snippet`, and custom `extra` fields. The message ID key matches the corresponding message in the chat history.

---

## Testing

```ts
// Fake backend — streams canned tokens, no server:
import { provideFakeAgent } from '@threadplane/ag-ui';
providers: [provideFakeAgent({ tokens: ['Hello', ' world'] })];
```

For component/unit tests, use the neutral writable-signal mock `mockAgent()`
from `@threadplane/chat` — the AG-UI agent _is_ the neutral `Agent` contract,
so there is no adapter-specific mock. See
[Choosing an adapter → Testing](https://threadplane.ai/docs/choosing-an-adapter#testing).

---

## Reliability

`@threadplane/ag-ui` shares the same runtime-neutral `Agent` contract as `@threadplane/langgraph`, making it interchangeable at the `<chat [agent]>` binding. The library follows a patch-only `0.0.x` release policy. The CI job "Library — lint / test / build" runs lint, test, and build on every pull request.

---

## Documentation

- [Quickstart](https://threadplane.ai/docs/ag-ui/getting-started/quickstart)
- [AG-UI adapter guide](https://threadplane.ai/docs/chat/guides/writing-an-adapter)
- [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui)
- [Choosing an adapter (LangGraph vs AG-UI)](https://threadplane.ai/docs/choosing-an-adapter)

---

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
are required. Production builds, SSR, imports, unused adapter construction, and
automated browsers reporting `navigator.webdriver` are inert.
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
