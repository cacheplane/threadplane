# Threadplane v0.2.0

Production-ready chat, thread/history/branch UI, interrupts, subagents, planning, memory, and generative UI for Angular agent apps.

Supported Angular majors: 20, 21, and 22.

## React previews
Experimental React examples are available at https://threadplane.ai/docs/langgraph/guides/streaming?frontend=react, https://threadplane.ai/docs/langgraph/guides/interrupts?frontend=react, https://threadplane.ai/docs/langgraph/guides/memory?frontend=react, https://threadplane.ai/docs/langgraph/guides/persistence?frontend=react, and https://threadplane.ai/docs/chat/guides/client-tools?frontend=react. The Example UI selector switches topic-specific documentation, source, and runtime together. Interrupts demonstrates a simulated refund with native approve, decline, and edit controls; every pause blocks text and uncertain decisions are never silently replayed. Memory streams each reply before extracting confirmed string facts into the same thread; New conversation clears the transcript and facts. This is thread-scoped context, not Store API or cross-thread memory. Client tools runs five authored browser functions with simulated weather, finalized panels and fictional booking decisions. Normal tools follow up in the same thread; a standalone weather snapshot persists its acknowledgement without another model run. Stop revokes pending decisions. Persistence lists confirmed conversations created on the current page and loads their saved history from the server when selected. Reloading clears the picker, not server history; this is not a server-wide catalog. Stopped, failed, uncertain or paused entries become unavailable. Other React topics show an availability notice. React, core, content, and the neutral LangGraph candidate remain private source-build packages, with no npm installation instructions or full catalog parity claim. Build from the repository with `npx nx build cockpit-langgraph-streaming-react`, `npx nx build cockpit-langgraph-interrupts-react`, `npx nx build cockpit-langgraph-memory-react`, `npx nx build cockpit-langgraph-client-tools-react`, or `npx nx build cockpit-langgraph-persistence-react`; verify with the matching `npx nx e2e` target. All five previews share the existing Python backend deployment.

## License and deployment boundary
- Every Threadplane package is MIT-licensed and free for commercial and noncommercial use.
- Threadplane runs inside the customer's Angular application. Agent runtime, models, storage, checkpointing, retention, authorization, and hosting remain customer-operated.
- Package use requires no registration, activation, or runtime check.

## Install
npm install @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked

The chat, LangGraph, AG-UI, and render packages include automatic install collection
for local and CI execution: package/environment details, a random installation ID,
configured Git name/full email, and repository provider/owner hints when available.
Set `DO_NOT_TRACK=1` or `TPLANE_TELEMETRY_DISABLED=1` before installation to disable
it. Package-manager script controls are respected. A usable install email can qualify
for a short founder welcome sequence after linked development-browser use, capped
at three emails with unsubscribe and reply stops. CI alone does not trigger it.
The package-local correlation token contains no email; copied/cached packages can
retain it, so it does not verify a person. No registration is required.
See https://threadplane.ai/privacy.


Supported runtime/browser collection is automatic only in Angular development mode.
Production builds, SSR, imports, and automated browsers reporting
`navigator.webdriver` are inert. Creating an agent (or a render element) in a
development-mode browser reports one session start per integration per session;
milestones are reported only when the runtime is actually used. It sends closed
progress milestones with package/version and random browser-origin/session IDs, never
conversation content or private URLs. Adapter `telemetry: false` disables it; a custom
sink replaces the automatic destination, including nested chat JSON rendering. Use
`setDevelopmentCollectionEnabled(false)` from `@threadplane/telemetry/browser`, or set
browser localStorage `THREADPLANE_TELEMETRY_DISABLED=1` and reload. Development console
announcements need no click to acknowledge progress. Linked non-CI install and runtime
evidence can qualify the install email for the founder sequence described above.
Standalone render also accepts `provideRender({ telemetry: false })`.

## Key requirement
`injectAgent()` MUST be called within an Angular injection context (component constructor or field initializer). Calling it in ngOnInit or any async context throws "NG0203: inject() must be called from an injection context".

## Basic usage
```typescript
// app.config.ts
import type { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/langgraph';
export const appConfig: ApplicationConfig = {
  providers: [provideAgent({ apiUrl: 'http://localhost:2024', assistantId: 'chat_agent' })]
};

// chat.component.ts
import { Component } from '@angular/core';
import { injectAgent } from '@threadplane/langgraph';
import { ChatComponent as ThreadplaneChatComponent } from '@threadplane/chat';

@Component({
  imports: [ThreadplaneChatComponent],
  template: `
    <chat [agent]="chat" />
  `,
})
export class ChatComponent {
  chat = injectAgent();
}
```

## Key patterns
- Thread selection: configure `provideAgent({ assistantId, threadId: signal(localStorage.getItem('t')), onThreadId })`; actual durability and cross-device persistence depend on the connected runtime and persistence layer
- Global config: `provideAgent({ apiUrl, assistantId })` in app.config.ts
- Scoped config: re-provide `provideAgent({ apiUrl, assistantId })` in a component `providers` array for a subtree
- Testing: use `MockAgentTransport` — never mock `injectAgent()` itself


## Interrupts and recovery

- Both adapters expose `interrupt()` and `submit({ resume })`; the backend defines the decision payload.
- AG-UI `auto` prefers native interrupt batches regardless of event order. Answer every pending native ID once; `status: 'cancelled'` entries omit `payload`.
- For Mastra, set `interruptTransport: 'mastra-command'`. The adapter sends the decision in `forwardedProps.command.resume` and observed correlation IDs in `command.interruptEvent`. The campsite example rejects with `{ approved: false }`.
- AG-UI restoration is opt-in through `persistence`: stable `threadId`, scoped namespace, and application-owned atomic compare-and-swap storage. Await `agent.ready` before rendering restored decisions.
- Capture `interruptSession().generation` when rendering and pass it as the `interruptGeneration` submit option to reject stale controls.
- Retry the retained decision only after proven non-dispatch or authoritative reconciliation. Configure `persistence.reconcile` and call `agent.reconcileInterrupt()` for uncertain outcomes; a network error alone does not prove non-execution.
- These recovery APIs are AG-UI extensions. LangGraph uses its own thread/checkpoint APIs. Client storage cannot recreate a lost backend checkpoint or guarantee exactly-once side effects.
- An approval card closing or local streaming stopping does not prove backend completion or cancellation.

## Version check
If this file is stale, fetch the latest: https://threadplane.ai/llms-full.txt
