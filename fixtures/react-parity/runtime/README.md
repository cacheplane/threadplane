# Installed native runtime consumers

## Explicit resume contract

The private development session exposes
`resume(value?: PlainValue, options?: { signal?: AbortSignal })`. Supply the
application's response for a dynamic interrupt, including an interrupt-ID map
when responding to several interrupts. Omit the response to continue a static
breakpoint. `false`, `0`, `''`, and `null` are responses and are preserved. The
runtime owns a plain-data copy; it does not validate an application schema,
select interrupt targets, or transform arguments.

Resume requires an observed pause and no active run, history load, unresolved
submission recovery, or unsettled tool results. It creates a null-input run on
the same thread with the supplied resume command, without a new human message.
Function-tool follow-ups use ordinary result messages and never repeat that
command. React and Angular borrow this application-owned session through their
existing observers. Construction and observation do not resume a graph.

Stop and disposal end local ownership; they do not cancel remote side effects.
The owned SDK transport defaults to zero request retries. If a resume connection
drops without conclusive completion, the outcome stays unconfirmed:
`retryable: false`, `recovery: 'none'`. Submission's human-message correlation
cannot prove a resume's outcome, so `checkStatus()` does not reconcile it.
When no unsettled tool results remain, an explicit `load()` can inspect current
history. This does not prove the earlier command completed or retry it. Loading
a pause and choosing Resume again is a new command; it can repeat server work
if the earlier run is still active. Failed tool follow-ups retain their buffered
results and continue to block load/resume; an explicit normal submission can
hand them off under the existing session contract.

This is a backend-private runtime milestone. Run-ID recovery, joining an existing
run, checkpoint selection, and public backend package cutover remain separate
work. The fixture's emitted declaration is a development consumer contract, not
a new published LangGraph entry point.

## Manual review

From the repository root, install dependencies and build the artifacts used by
the review runner:

```sh
npm ci
NX_DAEMON=false npx nx run-many -t build -p core,angular,react --skip-nx-cache
npx playwright install chromium
node scripts/react-parity/review-runtime.mjs
```

On Linux, install browser system dependencies with
`npx playwright install --with-deps chromium`. The runner requires the existing
`dist/libs/{core,angular,react}` artifacts and reports the build command if they
are missing. `node scripts/react-parity/review-runtime.mjs --help` prints the
prerequisite and review sequence.

The runner packs those artifacts, installs and strictly type-checks isolated
React and Angular consumers, builds each app, and runs all thirteen browser
scenarios on fresh fixture servers. Only after those checks pass does it print
two new, untouched loopback URLs. Open each URL manually; no browser opens
automatically. The review servers have made no SDK requests at that point.
Separate preparation processes keep each framework's install/build environment
isolated. The shared stylesheet and labelled panels are fixture review aids.

The printed source HEAD and dirty source paths identify the checkout used for
the private runtime bundle and fixture UI. They do **not** establish which commit
built the preexisting package artifacts. Printed SHA-256 identifiers separately
identify the actual packed bytes installed in each consumer. Rebuild the
prerequisites when changing core or either native binding.

Use this order once per fresh server, waiting for each expected state:

| Action | Expected visible state |
| --- | --- |
| Open | Idle; zero loads, submissions and handler calls; values `unobserved`; interrupts `[]`. Mount performs no SDK I/O. |
| Load | Loads finished `1`, empty Load error, saved transcript and profile, two saved interrupt payloads, delivery `complete:paused`. No tool handler executes. |
| Load again | Loads finished `2`, empty Load error; the same saved content, values, interrupts and paused delivery. |
| Load a third time | Loads finished `3`, empty Load error; empty transcript, values `unobserved`, interrupts `[]`. |
| Send | `Hello 🌍.`, idle, delivery `complete:success`; values show the completed stage. |
| Tool | `20 degrees`, a completed weather result for Paris, handler calls `1`; delivery `complete:success`. |
| Error | Status `error` and a protected error message without the private backend diagnostic. Prior delivery remains `complete:success`; this fixture error does not replace it. |
| Hold | `Held partial` appears while delivery is `streaming`. |
| Stop | Delivery becomes `complete:aborted`; the native held response closes and partial text remains visible. |
| Pause | `Waiting for approvals`, both live interrupt payloads, idle, delivery `complete:paused`. |
| Stop again | Both interrupts and `complete:paused` remain; no extra request is made. |
| Resume | Sends both authored approval responses; shows `One final approval`, one new interrupt, resume outcome `paused`, resumes finished `1`. Human messages remain `5`. |
| Resume again | Shows `Approvals complete` in the same assistant message, interrupts `[]`, delivery `complete:success`, resume outcome `success`, resumes finished `2`. Human messages remain `5`. |
| Send again | Another successful greeting, interrupts `[]`, delivery `complete:success`; submissions `6`, handler calls `1`. |
| Unmount | Component panels disappear; the separate owner controls report `unmounted`. |
| Dispose | Owner reports `disposed`. |
| Send after dispose | Owner reports `aborted`; no request is made. |
| Resume after dispose | Owner reports `aborted`; no request is made. |

This sequence makes three history reads with `{ limit: 10 }` and nine run
requests: six submissions, one tool continuation, and two resumes. Each server permits only three Load
requests. Restart the CLI for a fresh sequence; reloading the page does not reset
server history. Unmount releases the framework observer, while the application
owns the session and explicitly disposes it.

Keep the CLI running during review. Ctrl+C or SIGTERM closes its servers and
connections, stops and awaits preparation process groups, and removes this
invocation's temporary consumers. Startup failures use the same cleanup path;
if a preparation process group cannot be stopped, its temporary files are
retained and an error is reported. Process-group cleanup targets POSIX macOS and
Linux. The local HTTP/SSE fixture is not a production backend, public backend
API, SSR demonstration, or complete React migration.

## Automated installed-consumer verification

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
backend values and interrupt metadata/payloads without application-schema inference.
The installed fixture shape uses core types only; the compiler-emitted factory
declaration and native inferred result are checked together, including tool types.

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

`LangGraphSnapshot.interrupts` now observes a readonly batch in that same immutable
aggregate. Each item retains SDK interrupt metadata and an owned plain payload;
neither metadata nor payload is a resume command or an inferred application schema.
Root `values`/`updates` controls must have an own array-valued `__interrupt__` field.
Separate dynamic batches accumulate: the first occurrence of a string ID wins,
while anonymous entries stay distinct. An empty `__interrupt__` array replaces
the batch with the static breakpoint sentinel `{ when: 'breakpoint' }`; the next
dynamic batch replaces that sentinel. An explicit empty standalone `interrupts`
batch clears the observed batch.

Authoritative checkpoints and latest history replace interrupts. A valid values
control takes precedence; otherwise all top-level task interrupt arrays contribute.
Child namespaces, nested task state and `next` alone do not establish a root pause.
History pause delivery is derived from the same candidate as messages, values and
interrupts. Equal refreshes retain identity, and values-only refreshes share the
unchanged interrupt batch. An accepted submission or resume clears the prior batch;
stop, disposal and failures retain the last observed batch. Observation never
implicitly resumes or selects targets. Existing getter/stale-candidate guards, recovery
correlation, tool handoff and next-user-input behavior remain covered.

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
SSR, or a public LangGraph package cutover. Explicit resume is the subsequent private
capability described above. Core public contracts
are unchanged; the native signatures now retain the concrete snapshot extension.

The native fixtures expose Load, Send, Tool, Error, Hold, Pause, Resume and Stop buttons plus text,
transcript, values, interrupts, load completion/error, status, tool result, delivery, submission and
handler count outputs. A single app-owned
session is created outside component lifetime and outside React's StrictMode
tree; owner buttons perform framework unmount and explicit session disposal.
React uses a Vite production build. Angular uses the existing consumer template's
installed Angular CLI application builder and real APF linking, with output in
`dist/consumer/browser` and input evidence from `dist/consumer/stats.json`.

Both built apps run the same thirteen browser scenarios in installed Playwright
Chromium: inert mount, explicit history load, equal history refresh, empty history
replacement, successful text, a real local tool handler and exact
two-request result continuation, protected visible server error, held streaming
DOM updates and Stop, the full pause batch retained after Stop, an explicit response
map and second pause, same-message resume completion, reuse after Stop,
then unmount/dispose/post-disposal commands.
Six submissions and two resumes through the component controls make exactly nine
run requests (including one tool continuation) and call the handler once. The separate
post-disposal submit and resume attempts resolve aborted without making requests.
Three explicit Load clicks make exactly three history reads with `{ limit: 10 }`
and no run requests or handler calls. Every completed load must leave its visible
error output empty, so retained text cannot conceal a failed equal refresh. Both
registered handlers increment the same counter if executed. Request bodies check
the catalog and actual serialized ToolMessage payload.
Values assertions distinguish unobserved from empty state, show loaded application
fields, and verify replacement/deletion across root, tool, held and reused runs.
Separate native component tests make four history reads to cover a values-only
refresh with unchanged messages and interrupts; installed browser scenarios still
make three. History fixtures contain two separate task payloads and show paused
delivery. The Pause button sends two separate root controls and renders both
payloads; Stop retains them without another request. Resume clears the old batch
and observes a new pause, then a second explicit resume completes without adding
human messages. Both null inputs and exact response maps are asserted server-side.
Unrelated custom/child noise does not contain a root empty control, because an
actual empty root `__interrupt__` is a static breakpoint rather than noise.

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
