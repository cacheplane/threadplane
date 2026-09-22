# Installed native runtime consumers

Run the owned commands from the repository root. On a fresh checkout, install
dependencies, build the private artifacts, and install Playwright Chromium:

```sh
npm ci
npx nx build core
npx nx build content
npx nx build angular
npx nx build react
npx playwright install chromium
```

On Linux CI, use `npx playwright install --with-deps chromium` to install the
browser's system dependencies too. Then run:

```sh
node --test scripts/react-parity/verify-packages.spec.mjs scripts/react-parity/runtime-consumer.spec.mjs scripts/react-parity/verify-angular-package.spec.mjs
node scripts/react-parity/verify-packages.mjs
node scripts/react-parity/verify-angular-package.mjs
```

The verifiers pack and install local tarballs in temporary directories. Core
installs alone with zero implementation dependencies. React installs no Angular
or backend SDK; Angular installs no React or backend SDK. Framework/compiler
versions come from the root lockfile. Contract probes compile the installed
public entries with `strict` and `skipLibCheck:false`, standard DOM signals, and
no workspace aliases. Negative probes check names, arguments, results and deep
readonly types directly on each binding's inferred snapshot, including broad
backend values without application-schema inference.

`runtime-entry.ts` is development-only composition around private `createSession`,
the production `FetchStreamTransport`, and the real LangGraph SDK. A focused
TypeScript check resolves its public core imports against the installed tarball
declarations, then emits its narrow annotated fixture return type. It replaces
the core getter with `Omit<AgentSession<FixtureTools>, 'getSnapshot'>` and a concrete
snapshot getter, avoiding an intersected overload that would hide `values` from
inference; `load` remains optional. Vite bundles the private backend
and SDK into temporary ESM, externalizing
`@threadplane/core` and `@threadplane/core/tools`. Only that JavaScript bundle and
entry declaration are copied into each installed consumer. No private TypeScript,
transitive private declarations, workspace aliases, or core/framework source is
copied. This is not a neutral LangGraph tarball or a new public entry; the existing
LangGraph package root remains Angular during this migration.

The session-owned SDK transport defaults `maxRetries` to `0`, so an ambiguous
failed request is not automatically sent again. A positive
`clientOptions.maxRetries` explicitly opts into SDK retries; a caller-supplied
transport owns its retry policy. Canonical updates may replace or remove pending
tool calls for the same assistant message while retaining other messages' calls
and completed results.

The private `LangGraphSnapshot.values` is a broad
`Readonly<Record<string, PlainValue>> | undefined`. It is observed application data,
not a validated application schema. `undefined` means no current values map is
observed; `{}` means a root record was observed with no application fields. Root
`values` and `checkpoints` records, explicit history, and conclusive recovery
correlated to the attempted run replace the whole map, including deleted fields.
`messages` and `__interrupt__` are excluded. Missing history values clear the map
to `undefined`. Child streams, node updates, custom events and live interrupt
envelopes do not replace it.

Messages and values publish together as one owned immutable snapshot. Equal maps
retain identity, changed maps share unchanged nested branches, and token-only
updates reuse the owned map without traversing it. This adds no I/O. Narrow SDK
normalization prevents raw data fields from overriding protocol type/namespace;
`messageMetadata` selects delta text semantics only for actual message events.
The application field remains observable as data. The native bindings infer
the concrete snapshot through structural getter/subscription signatures while
retaining typed tool results, method receivers and borrowed lifetime semantics.
The factory and snapshot extension remain private; state writes, application
schema inference, SSR and package-root cutover remain outside this slice.

The private `LangGraphSession` offers `load({ signal })` only when its transport
supports history reads. Loading is explicit: construction, mount and subscription
perform no I/O. The latest checkpoint authoritatively replaces the transcript,
including deleted/reordered messages and shorter or empty corrections. Equal
reads preserve snapshot identity; unchanged explicit message IDs retain shared
immutable objects. Snapshots stay unchanged while loading and on read failure;
failures reject with protected diagnostics. Cancellation, supersession, stop and
disposal settle promptly even if a transport ignores abort, and stale reads cannot
publish. Loading is refused while execution, uncertain recovery, staged tool
results or asynchronous tool settlement/write work remains unresolved.

History is observation only: loading never executes pending tools. Execution
deduplication survives a load, while locally authored result provenance is cleared.
Persisted ToolMessage strings remain transcript text rather than becoming typed
handler results, including on later stream replay. This is a fixed-thread history
subset of T10, not thread switching, pagination, branching, state writes,
interrupt resume, SSR, or a public LangGraph package cutover. Core public contracts
are unchanged; the native signatures now retain the concrete snapshot extension.

The native fixtures expose Load, Send, Tool, Error, Hold and Stop buttons plus text,
transcript, values, load completion/error, status, tool result, delivery, submission and
handler count outputs. A single app-owned
session is created outside component lifetime and outside React's StrictMode
tree; owner buttons perform framework unmount and explicit session disposal.
React uses a Vite production build. Angular uses the existing consumer template's
installed Angular CLI application builder and real APF linking, with output in
`dist/consumer/browser` and input evidence from `dist/consumer/stats.json`.

Both built apps run the same ten browser scenarios in installed Playwright
Chromium: inert mount, explicit history load, equal history refresh, empty history
replacement, successful text, a real local tool handler and exact
two-request result continuation, protected visible server error, held streaming
DOM updates and Stop, reuse after Stop, then unmount/dispose/post-disposal submission.
Five submissions through the component controls make exactly six run requests
(including one tool continuation) and call the handler once. The separate
post-disposal submit attempt resolves aborted without making a request.
Three explicit Load clicks make exactly three history reads with `{ limit: 10 }`
and no run requests or handler calls. Every completed load must leave its visible
error output empty, so retained text cannot conceal a failed equal refresh. Both
registered handlers increment the same counter if executed. Request bodies check
the catalog and actual serialized ToolMessage payload.
Values assertions distinguish unobserved from empty state, show loaded application
fields, and verify replacement/deletion across root, tool, held and reused runs.
Separate native component tests make four history reads to cover a values-only
refresh with unchanged messages; installed browser scenarios still make three.

A small in-process HTTP fixture serves only built artifacts and the expected
LangGraph run/history routes on dynamic port 0. The held response writes an actual SSE
assistant chunk and stays open. The test observes partial DOM text and streaming
delivery before pressing Stop, then awaits the server response-close handshake
and aborted delivery. This proves incremental DOM updates and native request abort in
these installed consumers. Whole-response SSE traces for the other scenarios
do not establish intermediate updates; controlled native DOM unit tests separately
cover publication timing and StrictMode subscription replay (production React
does not replay development StrictMode effects).

These checks make no claims about compositor timing, performance, SSR support,
or complete feature parity. The React development root-import probe, full Vite
app, Angular runtime app, and installation footprint are separate diagnostics.

Page errors and unexpected requests fail verification. Browser contexts,
browsers, held responses, server connections and temporary artifacts are closed
in `finally`, including on assertion failures. No remote deployment, production
product components, or showcase UI is involved.
