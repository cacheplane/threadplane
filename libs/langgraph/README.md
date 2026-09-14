# @threadplane/langgraph

The LangGraph adapter for [Threadplane](https://github.com/cacheplane/threadplane), the open-source thread-plane for agents. Wraps a LangGraph agent into the runtime-neutral `Agent` contract that `@threadplane/chat` consumes — the Angular counterpart to LangGraph's React `useStream()` hook, with signal-driven access to messages, status, tool calls, interrupts, subagents, branch history, and thread persistence.

<p align="center">
  <a href="https://www.npmjs.com/package/@threadplane/langgraph">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Flanggraph?color=6C8EFF&labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://angular.dev">
    <img alt="Angular 20 | 21 | 22" src="https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
</p>

> Talking to a non-LangGraph backend? See [`@threadplane/ag-ui`](https://www.npmjs.com/package/@threadplane/ag-ui) — same API shape, AG-UI protocol underneath.

## What it does

- **`provideAgent()`** — wire the LangGraph adapter into Angular DI. Provided at the root injector or at any component subtree (multi-thread UIs work via Angular's hierarchical DI).
- **`injectAgent()`** — retrieve the configured `LangGraphAgent` in any component. Returns a `LangGraphAgent` whose entire state surface (`messages`, `status`, `isLoading`, `error`, `interrupt`, `toolCalls`, `subagents`, `queue`, `branch`, `history`, and more) is exposed as Angular Signals. No subscriptions, no `async` pipe, no zone.js required.
- **Human-in-the-loop** — `interrupt()` delivers a runtime-neutral interrupt value; `langGraphInterrupts()` exposes the raw LangGraph interrupt list when you need it.
- **Subagent streaming** — `subagents()` + `getSubagent(toolCallId)`, `getSubagentsByType(type)`, `getSubagentsByMessage(msg)`, and `activeSubagents()` surface streaming subgraph state without extra bookkeeping.
- **Time-travel and thread persistence** — `branch()` / `history()` / `experimentalBranchTree()` enable checkpoint navigation; `LangGraphThreadsAdapter` provides SDK-backed thread CRUD so you never have to hand-roll thread management.

## Install

```bash
npm install @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked
```

**Peer dependencies:**

```
@threadplane/chat          *
@angular/core              ^20.0.0 || ^21.0.0 || ^22.0.0
@langchain/core            ^1.1.33
@langchain/langgraph-sdk   ^1.7.4
rxjs                       ~7.8.0
```

`marked` is the markdown parser peer that `@threadplane/chat` requires when assistant messages are rendered through `<chat>`.

## Quick start

Configure the LangGraph endpoint once in `app.config.ts`:

```ts
// app.config.ts
import { provideAgent } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({
      apiUrl: 'https://your-langgraph-platform.com',
      assistantId: 'my-agent',
    }),
  ],
};
```

Then call `injectAgent()` in any component and pass the result to `<chat />`:

```ts
// chat.component.ts
import { Component } from '@angular/core';
import { injectAgent } from '@threadplane/langgraph';
import { ChatComponent } from '@threadplane/chat';

@Component({
  imports: [ChatComponent],
  template: `<chat [agent]="chat" />`,
})
export class ChatComponentHost {
  protected readonly chat = injectAgent();
}
```

> `injectAgent()` must be called within an Angular injection context — a component field initializer or constructor. Calling it in `ngOnInit` or any async context throws `NG0203: inject() must be called from an injection context`.

> Need a different agent for a specific component subtree (e.g., a sidebar showing a separate conversation)? Re-provide `provideAgent({...})` in that component's `providers: []` array — Angular's hierarchical DI takes care of the rest.

## Capabilities

### Messages, status, and errors

| Signal | Type | Description |
|---|---|---|
| `messages()` | `Message[]` | Accumulated chat messages from the stream |
| `status()` | `'idle' \| 'running' \| 'error'` | Runtime-neutral run status |
| `isLoading()` | `boolean` | `true` while a run is streaming |
| `error()` | `unknown \| null` | Last error, if any |

### Human-in-the-loop (interrupts)

```ts
const pending = chat.interrupt();       // runtime-neutral interrupt value
const raw = chat.langGraphInterrupts(); // raw LangGraph Interrupt[]
```

Resume with `await chat.submit({ resume: response })`, where `response` matches the suspended tool's contract. LangGraph restores execution from its server checkpoint on the same thread. The shared `Agent` interface does not include AG-UI's browser persistence, interrupt session, or reconciliation extensions.

### Tool calls

`toolCalls()` is a Signal of all tool call entries observed in the current run, updated incrementally as the stream progresses.

### Subagents

```ts
chat.subagents()                       // Signal<Map<string, Subagent>> of all subagents
chat.activeSubagents()                 // currently streaming subagents (SubagentStreamRef[])
chat.getSubagent(toolCallId)           // look up by tool call ID
chat.getSubagentsByType(type)          // filter by subagent type
chat.getSubagentsByMessage(msg)        // filter by parent message
```

### Queue

`queue()` exposes pending run entries when the agent is configured with a multitask strategy that queues concurrent submissions.

### Branch, history, and time-travel

```ts
chat.branch()                   // current branch identifier Signal
chat.setBranch(b)               // switch to a checkpoint branch
chat.history()                  // runtime-neutral history entries
chat.langGraphHistory()         // raw LangGraph ThreadState[]
chat.experimentalBranchTree()   // full branching tree for time-travel UI
```

### Actions

```ts
chat.submit(input, opts?)                   // send a new message
chat.stop()                                 // cancel the active run
chat.regenerate(assistantMessageIndex)      // re-run from a prior assistant turn
chat.reload()                               // re-run the last submission
chat.switchThread(threadId)                 // load a different thread
chat.joinStream(runId, lastEventId?)        // reconnect to an in-flight run
```

### Thread persistence

`LangGraphThreadsAdapter` is a drop-in, SDK-backed thread store. Provide it alongside the agent config:

```ts
import { provideAgent, LangGraphThreadsAdapter, LANGGRAPH_THREADS_CONFIG } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({ apiUrl: 'https://your-langgraph-platform.com', assistantId: 'my-agent' }),
    { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'https://your-langgraph-platform.com' } },
    LangGraphThreadsAdapter,
  ],
};
```

Pair it with the lifecycle helpers to keep your thread list fresh:

```ts
import { refreshOnRunEnd, refreshOnTransition } from '@threadplane/langgraph';

refreshOnRunEnd(chat, () => threadsAdapter.refresh());
```

### Citations

`extractCitations(msg)` reads citation metadata from a LangGraph message's `additional_kwargs`, returning `Citation[] | undefined` (`undefined` when no citation metadata is present). It checks `additional_kwargs.citations` first, falling back to `additional_kwargs.sources`.

```ts
import { extractCitations } from '@threadplane/langgraph';

const citations = extractCitations(message);
```

`Citation` is a type from `@threadplane/chat`; `CitationsResolverService` also lives there.

## Testing

```ts
// Fake backend — streams canned tokens, no server:
import { provideFakeAgent } from '@threadplane/langgraph';
providers: [provideFakeAgent({ tokens: ['Hello', ' world'] })];
```

For component/unit tests, use the writable-signal mock `mockLangGraphAgent()`
(it extends the neutral `mockAgent` from `@threadplane/chat`). See
[Choosing an adapter → Testing](https://threadplane.ai/docs/choosing-an-adapter#testing).

Need to hand-script exact wire events (tool calls, interrupts, multi-batch
lifecycles)? `MockAgentTransport` is the advanced escape hatch — swap the
transport, never mock `injectAgent()` itself.

## Reliability

**Runtime-neutral contract.** `LangGraphAgent` implements the `Agent` contract from `@threadplane/chat`. Components that depend only on that contract are portable across adapters (`@threadplane/ag-ui`, future adapters) without modification.

**Release policy.** Patch-only `0.0.x` releases — every change, including breaking ones, increments the patch version until the library reaches `1.0.0`.

**CI.** The "Library — lint / test / build" job runs lint, tests, and build on every pull request.

## Documentation

- [Quickstart](https://threadplane.ai/docs/langgraph/getting-started/quickstart)
- [`injectAgent()` API reference](https://threadplane.ai/docs/langgraph/api/inject-agent)
- [`provideAgent()` API reference](https://threadplane.ai/docs/langgraph/api/provide-agent)
- [Human-in-the-loop / interrupts](https://threadplane.ai/docs/langgraph/guides/interrupts)
- [Thread persistence](https://threadplane.ai/docs/langgraph/guides/persistence)
- [Testing with `MockAgentTransport`](https://threadplane.ai/docs/langgraph/guides/testing)
- [Choosing an adapter (LangGraph vs AG-UI)](https://threadplane.ai/docs/choosing-an-adapter)

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
