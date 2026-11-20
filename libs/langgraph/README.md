# @threadplane/langgraph

The LangGraph backend for [Threadplane](https://github.com/cacheplane/threadplane), the open-source thread-plane for agents. `createSession()` runs a LangGraph deployment behind the framework-neutral `AgentSession` contract from `@threadplane/core`: messages, status, tool calls, interrupts, child agents, checkpoints and thread persistence, published as owned, frozen snapshots.

<p align="center">
  <a href="https://www.npmjs.com/package/@threadplane/langgraph">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Flanggraph?color=15253E&labelColor=0A0A0A&style=flat-square" />
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-15253E?labelColor=0A0A0A&style=flat-square" />
  </a>
</p>

This package contains no UI framework code. A binding observes the session it creates: `@threadplane/angular` for Angular, `@threadplane/react` for React.

> Talking to a backend that is not LangGraph? See [`@threadplane/ag-ui`](https://www.npmjs.com/package/@threadplane/ag-ui): the same session contract over the AG-UI protocol.

## Install

```bash
npm install @threadplane/langgraph @threadplane/core @langchain/core @langchain/langgraph-sdk
```

**Peer dependencies:**

```
@threadplane/core          same version as this package
@langchain/core            ^1.1.33
@langchain/langgraph-sdk   ^1.7.4
```

## Quick start

A session is a plain object with `getSnapshot()`, `subscribe()` and commands. It makes no request until a command is called.

```ts
import { createSession } from '@threadplane/langgraph';

const session = createSession({
  apiUrl: 'https://your-langgraph-platform.com',
  assistantId: 'my-agent',
});

const release = session.subscribe(() => {
  console.log(session.getSnapshot().messages);
});
await session.submit('Plan a visit');
release();
await session.dispose();
```

In Angular, hand the factory to the one provider and inject the agent. Its snapshot fields are Signals:

```ts
// app.config.ts
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({
      createSession: (context) =>
        createSession({
          apiUrl: 'https://your-langgraph-platform.com',
          assistantId: 'my-agent',
          ...context,
        }),
    }),
  ],
};
```

In React, create the session and pass it to `useAgent(session)` from `@threadplane/react`.

## Exports

The package root is the whole public surface. Everything is exported from `@threadplane/langgraph`; the session behaviour behind each name is described in the [session reference](./src/runtime/README.md).

**The session**

- `createSession(options, tools?)` and its types `SessionOptions`, `LangGraphSession`, `LangGraphResumeOptions`.
- What a submit and a run accept: `LangGraphSubmitInput`, `LangGraphSubmitState`, `LangGraphInputState`, `LangGraphRunOptions`, `LangGraphRunSettings`.
- Host hooks a binding or a development tool supplies: `LangGraphTelemetrySink`, `LangGraphTelemetryEvent`, `LangGraphTelemetryPayload`, `LangGraphDevelopmentRuntime`, `LangGraphDevtoolsSink`, `LangGraphDevtoolsSignal`, `LangGraphScriptedRun`, `LangGraphScriptedRuns`, `A2uiClientCapabilities`, `RuntimeOperationFailureReporter`.

**The snapshot**

- `LangGraphSnapshot`, `LangGraphSnapshotState`, `LangGraphState`, `LangGraphInterrupt`, `LangGraphWireInterrupt`, `LangGraphHistoryEntry`, `LangGraphSubagent`, `LangGraphDelegation`, `LangGraphSubgraph`, `LangGraphQueuedRun`, `LangGraphToolProgress`, `LangGraphWireMessage`, `LangGraphMessageMetadata`, `LangGraphLifecycle`, `LangGraphLifecycleSource`.

**Derived from a snapshot**

- Checkpoints and branches: `selectBranch`, `LangGraphCheckpoint`, `LangGraphBranchTree`, `LangGraphBranchNode`, `LangGraphBranchFork`.
- Raw LangGraph data: `langGraphToolCalls`, `getToolCalls`, `LangGraphToolCallWithResult`.
- `extractCitations(message)`: the citations in a wire message's `additional_kwargs`, as core `Citation` values.

**Saved conversations**

- `createLangGraphThreadDirectory(options)`: the core `ThreadDirectory` for a deployment's threads, with `LangGraphThreadDirectoryOptions` and `LangGraphThreadsClient`.
- `createLangGraphProjectStore(client)` and `ProjectStore`: project names in the LangGraph Store.

**Transports and the SDK client**

- `FetchStreamTransport`: the HTTP and SSE transport a session owns by default.
- `createLangGraphClient(apiUrl, clientOptions?)` and `toAbsoluteApiUrl(apiUrl)`: an SDK client that accepts a relative `/api` path in a browser.
- The transport contract for a custom transport: `AgentTransport`, `StreamEvent`, `LangGraphSubmitOptions`, `LangGraphClientOptions`, `AgentQueue`, `AgentQueueEntry`, `LangGraphMultitaskStrategy`, `LangGraphDurability`, `LangGraphOnCompletion`, `LangGraphOnDisconnect`, `CheckpointReference`, `OwnedCheckpointPosition`.

**Testing**

- `MockAgentTransport`: a scripted transport. A spec emits event batches and the real session projects them.
- `FakeStreamTransport` and `FakeStreamTransportConfig`: a transport that streams a canned reply, for offline demos.

Pass either as `createSession({ transport })`. Neither is for production use. For a session with no transport at all, use `createFakeAgentSession` from `@threadplane/core/testing`.

`@threadplane/langgraph/development-install` is the one secondary entry. It exports `installationToken`, described under "Installation collection" below.

## Removed in this release

The Angular adapter this package used to contain is gone: `provideAgent` and `injectAgent` (now in `@threadplane/angular`, taking `createSession`), `LangGraphAgent` and its option types, `AGENT_LIFECYCLE` and `AgentLifecycleRegistry`, `LANGGRAPH_CLIENT_OPTIONS`, `mockLangGraphAgent`, `provideFakeAgent`, and `LangGraphThreadsAdapter` with `LANGGRAPH_THREADS_CONFIG`, `LANGGRAPH_CLIENT`, `refreshOnRunEnd` and `refreshOnTransition`. Angular thread helpers live in `@threadplane/angular`; the neutral `createLangGraphThreadDirectory` stays here.

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

A session reports nothing by itself. It calls the `telemetry` sink and the `developmentRuntime` collector a host passes to `createSession`, and is inert when neither is given. See the
[telemetry controls and collection details](https://github.com/cacheplane/threadplane/tree/main/libs/telemetry#automatic-development-runtime-collection)
and [Privacy](https://threadplane.ai/privacy).
