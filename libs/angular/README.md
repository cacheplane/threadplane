# @threadplane/angular

The Angular binding for agent sessions, published to npm. It provides the one
Angular provider, `provideAgent({ createSession })`, the injected `Agent` (a
signal view of a session), the thread directory view, and the session
observers. A backend package such as `@threadplane/langgraph` or
`@threadplane/ag-ui` supplies `createSession`; this package imports neither.

The root also exports `observeAgent(session)`, which accepts `getSnapshot()` and `subscribe(notify)`
methods and returns a read-only `Signal<TSnapshot>`. The observer contract is
structural:

```ts
{
  getSnapshot(): TSnapshot;
  subscribe(notify: () => void): () => void;
}
```

`TSnapshot` is unconstrained. The binding preserves its exact authored type,
including readonly fields and, for core-compatible sessions, typed tool names,
arguments and results. It does not require a core display projection.

Call `observeAgent` in an Angular injection context, such as a component field
initializer or provider factory, with a session supplied by the app:

```ts
import { observeAgent } from '@threadplane/angular';
import type { AgentSession } from '@threadplane/core';

// Invoke this factory within an Angular injection context.
export function observeStatus(session: AgentSession) {
  return observeAgent(session);
}
```

`observeAgentState(session)` returns a signal of only the snapshot's `state`. It
changes when the state changes, not on every streamed token. The type comes from
the session: one created with a `stateType` yields that type, read-only, and any
other yields plain data. The value is `undefined` until the session holds a
state. It needs an injection context, like `observeAgent`.

```ts
import { observeAgentState } from '@threadplane/angular';

readonly todos = observeAgentState(this.session, (state) => state?.todos ?? []);
```

The optional selector runs once per state, and the signal changes only when the
selected value does. To change the state, send a patch with
`session.submit({ message, state })`.

The function borrows the session. Reading or subscribing does not start a run.
Snapshot reads and subscription calls preserve the session method receiver.
The injected `DestroyRef` releases only this observer's subscription when its
context is destroyed. Pending work continues, and other observers remain
connected. The app calls `session.submit(text)`, `session.stop()`, and
`session.dispose()` and owns the session's lifetime.

The owner must return a stable snapshot between changes, publish a changed
aggregate reference when data changes, and notify its subscribers. Subscribing
must register notifications without issuing commands and return an idempotent
release function. The owner is responsible for immutable snapshots; a readonly
Signal prevents replacing its value through the binding but does not freeze data
or add deep readonly types to caller-authored mutable fields.

Keep the concrete session type when observing backend-specific fields. The
LangGraph session exposes a broad readonly `values` map on its snapshot: `undefined`
means no current application-values map is observed, while `{}` is an observed
empty map. The binding preserves that field without inferring an application
schema, validating values, or issuing extra reads. Values and messages arrive in
the same immutable snapshot. Observing adds no state-writing, SSR, or hydration
support.

The AG-UI session is also observed directly: its native snapshot contains
`transcript`, `state`, `subagents` and root `run` evidence. Partial tool arguments
remain raw protocol strings; observing them does not authorize tool execution or
invent core pending-tool states. Integration tests run the actual session
through a browser-safe Fetch API fixture. This is not a claim that shared
display components accept every native snapshot. The AG-UI `createSession`
takes the whole session context, `createSession({ url, ...context })`: it
names a new conversation's thread itself and reports it through the context's
`onThreadId`, so `agent.threadId()` and `agent.switchThread()` work with no
application code reporting an id.

No backend constructor is exported here: sessions come from the backend
packages' `createSession`. This package does not claim full SSR or hydration
support. The Angular peer range
follows existing workspace policy; it is not a compatibility-matrix claim.

Build with `npx nx build angular` (ng-packagr and partial Angular compilation).
Run `npx nx test angular` and `npx nx run angular:type-tests` for real-session
and strict type coverage. The tests use Angular 21.1.6.

`@threadplane/angular/chat` is a separate APF entry holding the chat UI: `<chat>`,
its compositions and its headless primitives (see `chat/README.md`). Nothing in it
runs when it is imported: the first chat component an application creates sets up
the chat styles and the development collector. It also exports two small standalone
views. `TextTranscriptComponent` renders rows. Import it in your component's
`imports` and bind rows:

```html
<threadplane-text-transcript [messages]="rows" label="Conversation" />
```

Rows are readonly structural `id`, core `role`, and string `content` values; extra
fields are allowed. IDs must be unique within the list. Every supplied row renders
literally, including empty text and intentionally supplied system or tool rows.
Select visible rows in app composition without rewriting the owner's history.
The named section and ordered list preserve whitespace and keyed mounted DOM.
The component has no commands, subscription, token announcements, focus or scroll
behavior. A remount creates new DOM; the app still owns the session lifetime.

The same `/chat` entry exports standalone, OnPush `ToolObservationComponent`.
Import it in your component's `imports` and supply literal text:

```html
<threadplane-tool-observation
  name="weather"
  [argumentsText]="partialArguments"
  label="Worker weather"
/>
```

`name` and `argumentsText` are required string inputs. Optional `resultText` is
omitted when absent; an empty string still renders a Result field. The default
label is `Tool observation`. All text renders literally with whitespace and
long-line wrapping, including partial JSON and strings such as `null` or
`undefined`. The caller selects the call, associates its result and formats known
values. The component does not parse arguments, infer execution status, subscribe
or execute tools. Updating text preserves its mounted section and arguments DOM;
remounting creates new DOM.

The root entry point remains headless. These two text views do not provide Markdown,
execution controls, citations, reasoning, SSR or hydration; the chat UI in the same
entry point does. The AG-UI
review uses O(N) pure root-text selection with optional previous-output row reuse
bounded to current rows. Framework memoization follows immutable transcript
references and is disposable; it is not another owner or execution controller.

`@threadplane/angular/markdown` is a separate APF entry exporting standalone,
OnPush `MarkdownComponent`, with a required whole `MarkdownSnapshot` input:

```ts
import { Component, inject, InjectionToken } from '@angular/core';
import { observeAgent } from '@threadplane/angular';
import { MarkdownComponent } from '@threadplane/angular/markdown';
import type { Markdown } from '@threadplane/content/markdown';

export const ANSWER_MARKDOWN = new InjectionToken<Markdown>('Answer Markdown');

@Component({
  selector: 'app-answer',
  imports: [MarkdownComponent],
  template: '<threadplane-markdown [snapshot]="snapshot()" />',
})
export class Answer {
  readonly snapshot = observeAgent(inject(ANSWER_MARKDOWN));
}
```

Provide the app-owned content object for that token. Application composition
creates, updates and eventually disposes it. The native view only presents the
snapshot; it does not parse, subscribe or own that lifecycle. `observeAgent`
releases its subscription when the host is destroyed, independently of the
owner's lifetime. A document generation change resets local image state;
replacing an image destination allows recovery after a failed load.

The renderer uses semantic headings, lists, tables and disabled task checkboxes,
resolves references from the snapshot and presents HTML literally as text. Math
remains delimited text; citations are numbered or unresolved text markers.
Missing, blocked and failed images show an accessible alt-text fallback. The
fixed [`content/markdown` destination policy](../content/README.md) excludes data
images and preserves accepted URLs without bypassing Angular's sanitizer.
The root remains headless. Rich math, syntax highlighting, citation overlays,
custom registries, replacement of the public legacy renderer, SSR and hydration
remain separate work.

## The injected `Agent`

`provideAgent` gives a component tree one `Agent`: a session's snapshot fields
as signals, the session's commands, and what an injected instance needs because
it outlives any one session. The package imports no backend; the config supplies
a function that creates a session.

```ts
import { injectAgent, provideAgent } from '@threadplane/angular';

// app.config.ts
providers: [
  provideAgent({
    threadId: currentThreadId, // a string, null, or a signal the agent follows
    onThreadId: (id) => router.navigate(['chat', id]),
    // createSession from @threadplane/langgraph. Spread the context last.
    createSession: (context) =>
      createSession({ assistantId: 'chat', apiUrl, ...context }),
  }),
];

// component
readonly agent = injectAgent();
readonly count = computed(() => this.agent.messages().length);
send(text: string) {
  void this.agent.submit(text);
}
```

`Agent<TSession>` is derived from the session type:

- Every snapshot field is a read-only signal: `messages()`, `status()`,
  `toolCalls()`, and a backend's own fields. An optional field is a signal of
  its value or `undefined`. A field's signal notifies only when that field's
  own value changes.
- Every session command passes through with its own signature: `submit`,
  `stop`, and optional or backend commands such as `regenerate`, `resume` or
  `fork`. An optional command the session lacks is `undefined`, so a view can
  ask whether it exists.
- Where a session member and a snapshot field share a name, the session member
  is the one exposed.
- `getSnapshot`, `subscribe` and `dispose` are not exposed. The agent owns its
  sessions and disposes the last one with its injector.

The agent adds:

| Member | What it is |
| --- | --- |
| `threadId()` | The thread the agent is on, or `null` before one exists. |
| `switchThread(id \| null)` | Moves to another thread, or to a new empty one. |
| `isThreadLoading()` | True while the selected thread's history is read. |
| `sessionEpoch()` | How many times the session underneath was replaced. |
| `onStop(listener)` | Calls `listener` each time `stop()` is called. |
| `customEvents()` | The current run's custom events, oldest first. |
| `lifecycle` | Milestone timestamps as signals; also `AGENT_LIFECYCLE`. |

### Thread switching

A session belongs to one thread. `switchThread`, or a change of the configured
`threadId` signal to a different id, asks the config for a new session. The old
session's subscriptions are released first, then it is stopped and disposed, so
nothing it does afterwards reaches the agent. Every signal and command on the
agent stays the same reference and follows the new session. `switchThread` with
the current id reloads that thread.

When a thread is selected and the session offers `load`, its history is read
automatically. A session that creates its own thread reports the id through the
factory's `onThreadId`; the agent adopts it without switching, so the run that
created the thread continues.

`createSession` runs in the agent's injection context each time, so it may call
`inject()`. Its context has five fields: `threadId` (a string, or `null` for a
new thread), `onThreadId`, `clientOptions` from `AGENT_CLIENT_OPTIONS` (set with
`provideAgentClientOptions`, otherwise `undefined`), `reportOperationFailure`
(the host's operation failure reporter, otherwise `undefined`) and
`developmentRuntime`. Each is an option of the LangGraph `createSession` under
the same name, so `createSession({ assistantId, apiUrl, ...context })` passes
all of them on with no cast. A factory that picks fields instead drops the ones
it does not name. `clientOptions` is typed `object | undefined` because its
shape belongs to the backend; the backend reads the fields it knows.

### Typed refs and several agents

```ts
export const TRIP = createAgentRef<TripSession>('trip');
providers: [provideAgent(TRIP, { createSession: … })];
readonly agent = injectAgent(TRIP); // Agent<TripSession>
```

Each `provideAgent(ref, …)` call builds its own agent, so several refs can share
one `providers` array. The ref-less `injectAgent()` then resolves the last one
provided and warns in development mode; inject by ref instead.

A config may also be a `() => AgentConfig` factory. It runs once, in an
injection context.

### Custom events and lifecycle

`customEvents()` retains what `onCustomEvent` delivered during the current run.
It is empty again when the next run starts and when the agent switches threads,
and stays empty on a session without `onCustomEvent`. `agent.onCustomEvent`
itself keeps a listener registered across thread switches.

`agent.lifecycle` mirrors the session's `lifecycle` source and returns to null
on a thread switch. `AgentLifecycleRegistry`, provided in the root injector,
lists the lifecycle of every live agent for instrumentation.

### For libraries: a stop, and a replaced session

A library that runs work of its own for an agent, such as a client tool handler
in the browser, registers `agent.onStop(listener)`. The listener is called each
time `stop()` is called on the agent, before the session is told, through any
reference to `agent.stop`. The registration outlives thread switches and ends
with the returned release or with the agent. A thread switch stops the old
session itself and calls no listener.

`agent.sessionEpoch()` is 0 for the session the agent was built with and one
more after each thread switch, including a reload of the same thread. Read it
in an effect to redo what belongs to one session, such as handing the new
session a client tool catalog. It does not move when a session reports the
thread it created.

#### Development-install collection

This package does not import the telemetry package and collects nothing. It is
the seam between a session and the collector:

- Each session factory call receives `context.developmentRuntime`, a factory
  for the session's collector. The first-party sessions take it as their
  `developmentRuntime` option, so `createSession({ ...context, ... })` passes
  it on. A factory that picks fields from the context instead must pass
  `developmentRuntime: context.developmentRuntime` to keep collection.
- The collector comes from a host that registers one with
  `ɵsetAgentDevelopmentHost`. `@threadplane/angular/chat` does so when the app
  creates its first chat component, so an app that provides an agent and renders
  chat needs no setup. An app that never renders a chat component has no
  collector and reports nothing. A host registered later (a lazy route) is
  connected to the agents that already exist.
- Each agent is registered once with the host's policy registry (or with a
  registrar provided under `ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR`, which wins).
  Its policy asks the current session's `isDevelopmentRuntimeEnabled()` each
  time and is false for a session without that member. The first-party
  sessions answer true unless they were created with a `telemetry` option.

Collection happens only in an Angular development build running in a browser,
and never after the opt-outs the telemetry package documents.

### Replacing or wrapping a member

To hand a part of the app an agent whose `submit` is guarded, or whose commands
add something to every call, derive one with `withAgentOverrides`. Do not copy
the agent with an object spread.

```ts
import { injectAgent, withAgentOverrides } from '@threadplane/angular';

export class ReviewPanel {
  private readonly locked = signal(false);

  protected readonly agent = withAgentOverrides(injectAgent(), (agent) => ({
    submit: (input, options) =>
      this.locked()
        ? Promise.resolve('aborted')
        : agent.submit(input, options),
  }));
}
```

The result is the same `Agent` type, so it goes wherever the agent goes, such as
a chat component's `agent` input. It serves the overrides and forwards every
other read to the original at the time of the read. The members it does not
override are the same references as the original's; a thread switch on either
one is seen through both; and a field that was not set when the agent was
derived, such as `error`, is a signal of `undefined` that carries the value once
it is published.

A spread cannot do this. An agent serves an optional field that is not set yet
only when it is asked for by name, and the names a backend may publish are not a
closed list, so `{ ...agent, submit }` copies the members that exist at that
moment and `copy.error()` then throws in a template.

The second argument is an object of replacements, or a function that is called
once with the original agent and returns one. Each replacement has the type of
the member it replaces. `undefined` for an optional command, such as
`regenerate`, makes the derived agent read as not having it. The original agent
is not changed: code that holds it, including a chat component given the
original, does not see the overrides. A derived agent can be derived from again.

### Without a backend

```ts
import { provideFakeAgent } from '@threadplane/angular/testing';

providers: [provideFakeAgent({ tokens: ['Hi', ' there'], delayMs: 0 })];
```

`provideFakeAgent` and `injectFakeAgentSession` are in the
`@threadplane/angular/testing` entry, so the root entry imports no testing
code. `provideFakeAgent` provides the same `Agent` over the in-memory session from
`@threadplane/core/testing`. Each submit streams a canned reply; a new thread is
named on its first submit, and a thread comes back with its messages when the
agent returns to it. `injectFakeAgentSession()` returns a signal of the current
fake session's controls for a test to drive.

Pass a ref first to provide the fake under it. The ref may be declared with a
backend's session type, so a component that injects that ref runs unchanged:

```ts
export const TRIP = createAgentRef<LangGraphSession<Tools, Board>>('trip');

providers: [provideFakeAgent(TRIP, { session: { state: { todos: [] } } })];
// in the test
const fake = injectFakeAgentSession(TRIP);
fake().setState({ todos: ['Book a hotel'] });
```

The fake's `state` is typed by the ref's state and its tool calls by the
ref's tool names. The fake is the core session and nothing more. The injected
agent is still typed as the backend's, so a snapshot field that only the
backend publishes, such as `subgraphs` or `history` on a LangGraph session,
reads as `undefined`, and a command that only the backend has is not there.
To test code that depends on those, build the real session on the backend's
test transport instead: `createSession({ transport: new MockAgentTransport() })`
from `@threadplane/langgraph`. A spec drives each run of that transport with
`emit()` and `close()`, any number in sequence, and `fail()` scripts a failed
run for `agent.retry()`.

### Providing an agent a test already has

`provideAgentValue(agent)`, also in `@threadplane/angular/testing`, makes
`injectAgent()` return the object it is given. Use it when the component under
test injects its agent and the test wants a mock in its place, such as
`mockAgent()` from `@threadplane/angular/chat`, or an agent it built by hand:

```ts
import { provideAgentValue } from '@threadplane/angular/testing';
import { mockAgent } from '@threadplane/angular/chat';

const agent = mockAgent({ status: 'running' });
TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
const view = TestBed.createComponent(AssistantPage); // calls injectAgent()
agent.messages.set([{ id: 'a1', role: 'assistant', content: 'Hi' }]);
```

`provideAgentValue(ref, agent)` also answers `injectAgent(ref)`. The ref-less
`injectAgent()` at that injector level returns the same agent, and a provider
given later in the same `providers` array wins, as with `provideAgent`. Under a
ref declared with a backend's session type the agent may be a core-shaped mock;
a member only the backend has is then `undefined` on it. To replace an agent a
component provides for itself, put the provider in
`TestBed.overrideComponent(Component, { set: { providers: [...] } })`.

`AGENT_LIFECYCLE` resolves to the given agent's own `lifecycle` object, so a
mock's writable marks reach whatever reads the token. An agent with no
`lifecycle` gets one whose milestones all stay null. The test owns the agent:
the injector does not stop or dispose it, does not list it in
`AgentLifecycleRegistry`, and does not register it for development-install
collection.

Choose `provideFakeAgent` for the real agent over an in-memory session, with
thread switching and the session's own command behaviour, and
`provideAgentValue` for an exact object whose fields the test sets directly.

### How member names are resolved

The agent reads each name from the session first, then from the snapshot. A
name found in neither is an optional snapshot field that is not set yet, so it
reads as a signal of `undefined`. The exceptions read as `undefined`:

- The members a session type declares optional, which a caller asks for before
  using: `onCustomEvent`, `runWithoutMessage`, `regenerate`, `resume`,
  `clientTools`, `checkStatus` and `retry` from the core contract, `load` from
  both first-party backends, and `onRawEvent`, `reconcileInterrupt`, `ready`,
  `agentId` and `stateType` from the AG-UI session.
- The commands one first-party backend always has: `isDevelopmentRuntimeEnabled`
  on both, and `fork`, `reconnect`, `joinStream`, `setBranch`, `cancelQueued`
  and `clearQueue` on a LangGraph session. They are typed as present on that
  backend's agent and need no `?.` there. They read as `undefined` only on a
  session of another kind, such as the fake provided under a backend's ref.
- Any name in `AgentConfig.optionalCommands`. A backend that adds an optional
  command lists it there.
- Names that tools probe on arbitrary objects, such as `then` and `toJSON`.

## The injected thread directory

`provideThreadDirectory` gives a component tree one view of a core
`ThreadDirectory`: its snapshot as signals and its commands. The package
imports no backend; the config supplies a function that creates the directory.

```ts
import {
  injectAgent,
  injectThreadDirectory,
  provideThreadDirectory,
  refreshOnRunEnd,
} from '@threadplane/angular';
import {
  createLangGraphThreadDirectory,
  type LangGraphThreadDirectory,
} from '@threadplane/langgraph';

// app.config.ts
providers: [
  provideThreadDirectory({
    createDirectory: ({ clientOptions, reportOperationFailure }) =>
      createLangGraphThreadDirectory({
        apiUrl,
        clientOptions,
        reportOperationFailure,
      }),
  }),
];

// component
readonly threads = injectThreadDirectory<LangGraphThreadDirectory>();
constructor() {
  void this.threads.refresh();
  refreshOnRunEnd(injectAgent(), this.threads);
}
```

| Member | What it is |
| --- | --- |
| `threads()` | Active threads, pinned first. |
| `archivedThreads()` | Archived threads. |
| `projects()` | Project names, or `undefined` when there are none to show. |
| `status()` | `'idle'`, `'loading'` or `'error'`. |
| `error()` | The last load failure; cleared by a successful load. |
| `isLoading()` | True while `status()` is `'loading'`. |
| `directory` | The `ThreadDirectory` underneath. |
| `refresh(options?)` | Reads the list again. A failed load is published, not thrown. |
| `getThread(id)` | One thread, or `null` when the backend says it does not exist. |
| `create(metadata?)` | Creates a thread; resolves with its id, or `null` on failure. |
| `rename`, `delete`, `archive`, `unarchive`, `pin`, `unpin`, `moveToProject`, `reorderPinned` | Row commands. |
| `createProject`, `renameProject`, `removeProject` | Project commands. |

Nothing is loaded until `refresh()` is called. A command the directory does not
offer is `undefined`, so a view offers no control for it. Plain
`injectThreadDirectory()` is typed by the core contract, where every command is
optional and is called as `threads.create?.()`. Naming the directory type, as
`injectThreadDirectory<LangGraphThreadDirectory>()` does above, types the
commands that type guarantees as present, so they are called as
`threads.create()`. A row or project command shows at once, rolls back when
it fails and rejects with the directory's error. The view owns the directory
and disposes it with its injector.

The row commands carry the names a thread list uses for its actions, and each
list item is the directory's entry plus `status` (and `pinnedOrder`, the saved
rank among pinned threads, when the directory keeps one), so the view binds to the chat
library's thread views directly:

```html
<chat-sidenav
  [threads]="threads.threads()"
  [archivedThreads]="threads.archivedThreads()"
  [actions]="threads"
/>
<chat-thread-sidebar [directory]="threads.directory" [agent]="agent" />
```

`createDirectory` runs once, in the view's injection context, so it may call
`inject()`. It receives `clientOptions` from `AGENT_CLIENT_OPTIONS` and the
host's operation failure reporter. A config may also be a
`() => ThreadDirectoryConfig` factory.

### Reading one thread

`getThread(id)` answers from `ThreadDirectoryConfig.getThread` when the config
has one, else from the directory's `get(id)`. It resolves with the thread, or
with `null` when the backend says there is no such thread, and rejects when the
backend could not be asked. The LangGraph directory has `get`, so no reader
needs configuring for it: a missing or malformed id answers `null`.

`get` is optional in the core contract. With neither source the
view can answer only for a thread the directory lists: it reads the list once
if the thread is not in it, and rejects for a thread that is still not listed,
because a list is not proof that a thread does not exist.

### Run-end helpers

`refreshOnRunEnd(agent, fn)` calls `fn` each time the agent's status leaves
`'running'`, and keeps following the agent across thread switches.
`refreshOnTransition(signal, isActive, fn)` is the general form for a state
machine of the app's own. Both take a function or anything with `refresh()`,
swallow a rejected refresh, and must be called in an injection context.

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

