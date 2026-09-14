<p align="center">
  <img
    src="https://threadplane.ai/assets/hero.svg"
    alt="Threadplane — the open-source thread-plane for agents"
    width="100%"
  />
</p>

<p align="center">
  <em>The open-source thread-plane for agents.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@threadplane/chat">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Fchat?color=6C8EFF&labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://angular.dev">
    <img alt="Angular 20 | 21 | 22" src="https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://langchain-ai.github.io/langgraph/">
    <img alt="LangGraph" src="https://img.shields.io/badge/LangGraph-SDK-6C8EFF?labelColor=080B14&style=flat-square" />
  </a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/cacheplane/threadplane">
    <img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/cacheplane/threadplane/badge" />
  </a>
  <a href="https://www.bestpractices.dev/projects/13316">
    <img alt="OpenSSF Best Practices" src="https://www.bestpractices.dev/projects/13316/badge" />
  </a>
  <a href="https://hvtracker.net/agents/threadplane">
    <img alt="HVTrust" src="https://hvtracker.net/badge/threadplane.svg" />
  </a>
</p>

---

**Threadplane is the open-source thread-plane for agents.** Chat, durable
threads, persistence, human approvals, tool progress, subagents, and generative UI — built on
Angular Signals and dependency injection, for Angular 20–22. Your backend stays
where it is: Threadplane adapts a LangGraph or AG-UI agent into a runtime-neutral
`Agent` contract that the UI consumes, and renders generated UI with the design
system components you already own.

`MIT · Angular 20–22 · no account, no cloud`

---

## Install

```bash
npm install @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked
```

Talking to an AG-UI endpoint instead:

```bash
npm install @threadplane/chat @threadplane/ag-ui @ag-ui/client @ag-ui/core marked
```

**Peer dependencies:**

```
@angular/core              ^20.0.0 || ^21.0.0 || ^22.0.0   # every Angular package here
marked                     ^15.0.0 || ^16.0.0              # @threadplane/chat
rxjs                       ~7.8.0                          # @threadplane/chat and both adapters
@langchain/core            ^1.1.33                         # @threadplane/langgraph
@langchain/langgraph-sdk   ^1.7.4                          # @threadplane/langgraph
@ag-ui/client              *                               # @threadplane/ag-ui
@ag-ui/core                *                               # @threadplane/ag-ui
```

Each package README lists that package's full peer set.

---

## First success: a chat surface with no backend

Start with the fake agent. It streams a canned reply in the browser, so the UI
can be built and tested before a server, a graph, or an API key exists.

```typescript
// app.config.ts — no server, no LLM, deterministic output
import { ApplicationConfig } from '@angular/core';
import { provideFakeAgent } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideFakeAgent({ tokens: ['Hello', ' from', ' Threadplane'] }),
  ],
};
```

```typescript
// support-agent.component.ts
import { Component } from '@angular/core';
import { injectAgent } from '@threadplane/langgraph';
import { ChatComponent } from '@threadplane/chat';

@Component({
  imports: [ChatComponent],
  template: `<chat [agent]="agent" />`,
})
export class SupportAgentComponent {
  protected readonly agent = injectAgent();
}
```

`agent.messages()` and `agent.status()` are Angular Signals. Bind them directly
in a template — no subscriptions, no `async` pipe, no zone.js required. The same
fake agent is what tests run against: swap the transport, never the component.

Walkthrough: [Try without a backend](https://threadplane.ai/docs/chat/getting-started/try-without-a-backend).

---

## One UI, two adapters

When the UI works, point it at a real runtime. Only the provider changes — the
component above is untouched, because `@threadplane/chat` consumes the
runtime-neutral `Agent` contract rather than any adapter type.

```typescript
// LangGraph Platform, or a local `langgraph dev` server
import { provideAgent } from '@threadplane/langgraph';

provideAgent({ apiUrl: 'http://localhost:2024', assistantId: 'agent' });
```

```typescript
// Any AG-UI-compatible endpoint
import { provideAgent } from '@threadplane/ag-ui';

provideAgent({ url: 'http://localhost:8000/agent' });
```

Which one to pick: [Choosing an adapter](https://threadplane.ai/docs/choosing-an-adapter).

---

## See it running

- [demo.threadplane.ai](https://demo.threadplane.ai) — the LangGraph demo:
  streaming, durable threads, interrupts, subagents, and generative UI.
- [ag-ui.threadplane.ai](https://ag-ui.threadplane.ai) — the same chat surface
  over an AG-UI backend.
- [Generative UI, live in the docs](https://threadplane.ai/docs/chat/guides/generative-ui?mode=run).

---

## Packages

Published packages follow a patch-only `0.0.x` release policy: no minor or major
bump silently changes a lockfile.

| Package | Purpose | License |
|---|---|---|
| `@threadplane/chat` | The Angular agent chat surface: `<chat>`, headless primitives, opinionated compositions, interrupts, subagents, generative UI | MIT |
| `@threadplane/langgraph` | LangGraph adapter; `provideAgent()` / `injectAgent()` expose a LangGraph run as Angular Signals | MIT |
| `@threadplane/ag-ui` | AG-UI adapter; bridges any `@ag-ui/client`-compatible backend into the same chat surface | MIT |
| `@threadplane/render` | `@json-render/core`-backed Angular render engine that maps JSON specs to your own components | MIT |
| `@threadplane/a2ui` | A2UI protocol types, streaming parser, and dynamic-value resolver; pure TypeScript, no Angular dependency | MIT |
| `@threadplane/middleware` | Backend middleware for client-declared tools; the `/langgraph` entrypoint targets LangGraph.js | MIT |
| `@threadplane/telemetry` | Explicit Node and browser capture helpers for applications that choose to send events | MIT |

Generated UI renders through a registry you control:

```typescript
import { provideViews, views } from '@threadplane/render';

provideViews(views({ KpiCard: KpiCardComponent, DisruptionsTable: DisruptionsTableComponent }));
```

An agent can render those components and nothing else, so generative UI stays
inside your design system.

---

## Architecture

<p align="center">
  <img
    src="https://threadplane.ai/assets/arch-diagram.svg"
    alt="Threadplane architecture: Angular Component → injectAgent() → StreamManager Bridge → LangGraph Platform, with signals returned reactively"
    width="100%"
  />
</p>

`provideAgent()` creates the agent's internal `BehaviorSubject`s at
injection-context time — once, when the provider factory runs. `injectAgent()`
retrieves the configured agent in any component. The `StreamManager` bridge (the
only file that touches `@langchain/langgraph-sdk` internals) pushes stream events
into those subjects. `toSignal()` converts each subject to an Angular Signal,
also at construction time. Dynamic actions (`submit`, `stop`, `switchThread`)
push into the existing subjects — no new subjects are ever created after
construction. This architecture is required because `toSignal()` must be called
in an injection context and cannot be called again later.

The runtime-neutral `Agent` contract is the stability boundary between adapters
and the chat surface. `@threadplane/chat` consumes `Agent` — not
`LangGraphAgent` — so swapping `@threadplane/langgraph` for
`@threadplane/ag-ui` requires no changes to chat components or templates.

**Reliability:** every pull request runs the "Library — lint / test / build" CI
job across all packages. Testing uses `MockAgentTransport` to swap the transport
layer, so `injectAgent()` itself never needs to be mocked — just substitute the
transport.

---

## The Signals surface

`injectAgent()` is the Angular counterpart to LangGraph's React `useStream()`
hook, projected through the runtime-neutral `Agent` contract.

| Capability | `injectAgent()` (Angular) | `useStream()` (React) |
|---|---|---|
| Streaming state as reactive primitives | Angular Signals | React state |
| Messages signal | `messages()` | `messages` |
| Loading state | `isLoading()` | `isLoading` |
| Error state | `error()` | — |
| Runtime-neutral status | `status()` — `'idle' \| 'running' \| 'error'` | partial |
| Interrupt / human-in-the-loop | `interrupt()` (runtime-neutral) / `langGraphInterrupts()` (raw plural) | `interrupt` / `interrupts` |
| Tool call progress | `toolCalls()` | `toolCalls` |
| Branch / history | `branch()` / `history()` / `experimentalBranchTree()` | `branch` / `history` / `experimental_branchTree` |
| Pending run queue | `queue()` | `queue` |
| Subagent map and lookup | `subagents()` — `Signal<Map<string, Subagent>>` / `getSubagent(toolCallId)` | `subagents` / helper methods |
| Reactive thread switching | `switchThread(id)` | prop |
| Submit | `submit(values, opts?)` | `submit(values, opts?)` |
| Stop | `stop()` | `stop()` |
| Regenerate response | `regenerate(assistantMessageIndex)` | — |
| Reload last submission | `reload()` | — |
| Custom transport (for testing) | `MockAgentTransport` | mock fetch |
| Angular `ResourceRef<T>` compatibility | Full duck-type parity | N/A |
| Angular 20–22 Signals API | Native | N/A |
| SSR / Server Components | Client-side only | React Server Components (React) |

---

## Documentation

- [Try without a backend](https://threadplane.ai/docs/chat/getting-started/try-without-a-backend)
- [LangGraph quickstart](https://threadplane.ai/docs/langgraph/getting-started/quickstart)
- [AG-UI quickstart](https://threadplane.ai/docs/ag-ui/getting-started/quickstart)
- [Choosing an adapter](https://threadplane.ai/docs/choosing-an-adapter)
- [`injectAgent()` API](https://threadplane.ai/docs/langgraph/api/inject-agent)
- [Chat introduction](https://threadplane.ai/docs/chat/getting-started/introduction)
- [Human approvals and interrupts](https://threadplane.ai/docs/langgraph/guides/interrupts)
- [Durable threads](https://threadplane.ai/docs/langgraph/guides/persistence)
- [Subgraph and subagent streaming](https://threadplane.ai/docs/langgraph/guides/subgraphs)

---

## License and data handling

Every published package in this repository is released under the **MIT
License** — free for commercial and noncommercial use, modification, and
redistribution with the required notice.

There is no account to create and no Threadplane service between the application
and the agent backend: adapters talk to the endpoint that is configured. How
Threadplane handles data on its own properties is described at
[threadplane.ai/privacy](https://threadplane.ai/privacy).
