# @threadplane/ag-ui

The AG-UI backend for [Threadplane](https://github.com/cacheplane/threadplane), the open-source thread-plane for agents. `createSession()` runs any AG-UI-compatible backend behind the framework-neutral `AgentSession` contract from `@threadplane/core`: messages, status, tool calls, interrupts, child agents and client tools, published as owned, frozen snapshots.

<p align="center">
  <a href="https://www.npmjs.com/package/@threadplane/ag-ui">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Fag-ui?color=15253E&labelColor=0A0A0A&style=flat-square" />
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-15253E?labelColor=0A0A0A&style=flat-square" />
  </a>
</p>

This package contains no UI framework code. A binding observes the session it creates: `@threadplane/angular` for Angular, `@threadplane/react` for React.

> Running on LangGraph Platform? See [`@threadplane/langgraph`](https://www.npmjs.com/package/@threadplane/langgraph): the same session contract with checkpoints, branches and saved threads.

## Install

```bash
npm install @threadplane/ag-ui @threadplane/core @ag-ui/client rxjs
```

**Peer dependencies:**

```
@threadplane/core   same version as this package
@ag-ui/client       ^1.0.1
rxjs                ~7.8.0
```

RxJS is the stream type of the AG-UI client itself. This package uses it only for `FakeAgent`.

## Quick start

A session is a plain object with `getSnapshot()`, `subscribe()` and commands. It makes no request until a command is called.

```ts
import { createSession } from '@threadplane/ag-ui';

const session = createSession({ url: 'https://your-backend.example/agent' });

const release = session.subscribe(() => {
  console.log(session.getSnapshot().messages);
});
await session.submit('Plan a visit');
release();
await session.dispose();
```

Pass `{ agent }` instead of `{ url }` to run over an AG-UI client agent you built, HTTP or not.

In Angular, hand the factory to the one provider and inject the agent. Its snapshot fields are Signals:

```ts
// app.config.ts
import type { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/ag-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({
      createSession: (context) =>
        createSession({ url: 'https://your-backend.example/agent', ...context }),
    }),
  ],
};
```

Spreading `context` is all the wiring there is. It carries the selected thread (`threadId`, or `null` for a new conversation) and the agent's `onThreadId`. An AG-UI thread is named on the client: for a new conversation the session generates the id and reports it, so `agent.threadId()` is filled automatically as soon as the session exists, and `agent.switchThread(id)` or `agent.switchThread(null)` creates the next session the same way. No application code calls `context.onThreadId`.

In React, create the session and pass it to `useAgent(session)` from `@threadplane/react`.

## Exports

The package root is the whole public surface. Everything is exported from `@threadplane/ag-ui`; the session behaviour behind each name is described in the [session reference](./src/runtime/README.md).

**The session**

- `createSession(options, tools?)` and its types `SessionOptions`, `SessionCommonOptions`, `HttpSessionSource`, `AgentSessionSource`, `Session`, `ClientToolSession`, `ResumeOptions`.
- What a submit accepts: `SubmitInput`, `SubmitState`, `ApplicationState`.

**The snapshot**

- `SessionSnapshot`, `SessionInterrupt`, `SessionInputBlock`, `InputBlock`, `Observation`, `Transcript`, `SessionLifecycle`, `SessionLifecycleSource`.
- With client tools: `ClientToolSessionSnapshot`, `ClientToolCall`, `ClientToolBlocker`.

**Selectors over a snapshot**

- `projectMessages`, `projectToolCalls`, `projectStreamingToolCalls` and `Projectable`: core messages and tool calls.
- `projectTextTranscript` and `TextTranscriptRow`: plain text rows.
- `bridgeCitationsState(thread, messages)`: attaches `state.citations` to messages held outside a session. A session already does this for the messages it publishes.

**Pauses and their answers**

- `decisionState(snapshot)` and `DecisionState`: the pending decision and its phase.
- `interruptSession(snapshot)` and `InterruptSession`: the full interrupt batch and how far its answer has got.
- `Decision`, `DecisionRun`, `NativeDecision`, `NativeResponse`, `InterruptResponse`, `OwnedInterrupt`, `PauseId`, `InterruptMode`, `InterruptTransport`.

**Restoring a thread**

- `httpReplay(options)` with `HttpReplayOptions`, `ReplaySource`, `ReplaySubscribable`: replays a thread from the backend when a session is created.
- Saved threads: `SessionPersistence`, `ThreadRecord`, `ThreadContent`, `SavedPause`, `ReconcileAnswer`.

**Host hooks**

- `SessionTelemetrySink`, `SessionTelemetryEvent`, `SessionTelemetryProperties`, `SessionRequestType`, `SessionDevtools`, `ScriptedRun`.

**Testing**

- `FakeAgent` and `FakeAgentScript`: an in-process AG-UI agent that streams a canned or scripted reply. Pass it as `createSession({ agent: new FakeAgent() })`; the real session projects its events. Not for production use. For a session with no agent at all, use `createFakeAgentSession` from `@threadplane/core/testing`.

`@threadplane/ag-ui/development-install` is the one secondary entry. It exports `installationToken`, described under "Installation collection" below.

## Removed in this release

The Angular adapter this package used to contain is gone: `toAgent`, `provideAgent` and `injectAgent` (now in `@threadplane/angular`, taking `createSession`), `provideFakeAgent`, `AgUiAgent` and its option types, and the legacy interrupt-persistence types. `httpReplay`, `interruptSession`, `bridgeCitationsState` and `FakeAgent` remain, as the session's own versions.

## Documentation

- [Session reference](./src/runtime/README.md)
- [Threadplane documentation](https://threadplane.ai/docs)

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

A session reports nothing by itself. It calls the `telemetry` sink a host passes to `createSession`, and is inert when none is given. See the
[telemetry controls and collection details](https://github.com/cacheplane/threadplane/tree/main/libs/telemetry#automatic-development-runtime-collection)
and [Privacy](https://threadplane.ai/privacy).
