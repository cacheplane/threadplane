# Native conversation example

These private React and Angular examples use the installed native LangGraph
runtime with Threadplane's corresponding bindings, owned Markdown, tool
observations and a readonly supplied-trip recap. Both borrow the same application owner to open saved
conversations, restore history and stream new responses. They are contributor
examples, not published packages or replacements for the canonical Angular
chat example. This does not establish general framework or release parity.

The application owns one `@threadplane/content/messages` projection per selected
session. It adds authored trip-summary cards to the shared rows while preserving
their Markdown and tool observations. View removal does not release that content;
retiring the selection disposes it.

The React view composes `MessageList` with a stable authored row renderer and
`ChatInput` with the application's existing submit/stop commands. Its bounded
transcript follows updates only while pinned to the bottom. Conversation changes
reset the list; a title refresh keeps its DOM and scroll position. The React-only
production scroll test covers these behaviors against installed candidates.

React assistant rows also compose `Reasoning` using independently owned reasoning
Markdown snapshots. Saved reasoning starts collapsed; streamed reasoning starts
expanded. Manual choices persist through completion and reset for a new response
generation. The application supplies no elapsed timing. User/system/tool reasoning
is preserved by content ownership but not displayed here. Angular reasoning display
is outside this React slice. Installed production tests cover keyboard disclosure,
fresh responses, literal unsafe content and fresh-history selection; same-row
generation/reopening reset is covered by real-owner source component tests. The
separate view proof retains reasoning through absent-view streaming and remount.

The React decision adapter composes the installed `ApprovalCard` as an inline
named region with the existing reason and Approve/Decline actions. The application
still matches interrupts, captures occurrence tokens, gates repeated/stale actions,
and owns pending, consumed and uncertain states. The card never hides itself or
dispatches a command implicitly. Production tests exercise keyboard decisions,
disabled pending actions, retained uncertain decisions and exact resume payloads;
provenance requires the installed card's runtime and declarations.

## Setup and commands

Run commands from the repository root using **Node 22 and npm 10** (locally
verified with Node 22.23.2 and npm 10.9.8). Install the root lockfile without
updating dependencies:

```sh
npm ci
```

The development lifecycle targets macOS and Linux using POSIX process groups
for owned child-process cleanup. Local verification runs on macOS; the required
CI job runs on Linux. Windows development serving is unsupported.

Configure a reachable LangGraph deployment and an existing assistant before
starting the development server:

```sh
export NATIVE_LANGGRAPH_URL='http://127.0.0.1:2024'
export NATIVE_ASSISTANT_ID='chat'
npx nx serve native-conversation-react --configuration=development --port=4301
npx nx serve native-conversation-angular --configuration=development --port=4302
```

Choose the framework to serve, then open its printed ready URL. The defaults
are `http://127.0.0.1:4301/` for React and `http://127.0.0.1:4302/` for Angular.
An occupied requested port fails; neither server silently selects another port.
The upstream must be an HTTP(S) URL without embedded
credentials, a query, a fragment or dot segments. If the deployment needs an API
key, set `NATIVE_LANGGRAPH_API_KEY` in the server environment before serving.
This optional credential stays **server-only**: do not put it in source,
`browser-config.json`, a URL, a `VITE_` variable or a client bundle. The browser
uses the same-origin `/api` route; the owned proxy adds the upstream key. The
assistant identifier is public browser configuration.

`serve` requires both the endpoint and a nonempty assistant identifier. A build
with no `NATIVE_ASSISTANT_ID` succeeds and displays the setup screen without
creating a client or conversation. A configured production build needs a host
that serves its assets, handles conversation deep links and provides a
same-origin `/api` proxy; the static output does not include an upstream server.

```sh
npx nx run native-conversation-react:tooling-test
npx nx test native-conversation-react
npx nx test native-conversation-angular
npx nx build native-conversation-react --configuration=production
npx nx build native-conversation-angular --configuration=production
npx playwright install chromium
npx nx e2e native-conversation-react
npx nx e2e native-conversation-angular
node examples/chat/native/tooling/verify.mjs
node examples/chat/native/tooling/verify.mjs --framework=angular
```

The single tooling target runs the shared import-safe Node tests for both
frameworks without building or installing an app. The test and build targets
prepare isolated consumers from locally
built candidate tarballs and the root lockfile, using exact `npm ci`
installation. They compile against those installed declarations and runtimes.
Builds publish to `dist/examples/chat/native/react` or
`dist/examples/chat/native/angular`, including provenance. They replace previous
output only after successful compilation and validation.
Failed preparation preserves the previous valid build and removes owned
temporary files.

Each e2e target runs development, basic conversation, missing-configuration and
production cases against owned local fixtures. The production case contains
eleven browser scenarios and a separate actual React unmount/remount or Angular
component destruction/remount proof. The CLI builds the selected production
app, runs its installed shared-owner tests, then checks those production
scenarios and the selected view lifecycle. Angular compilation includes strict
installed TypeScript and Angular template checks; its view proof uses the
installed Angular application builder. No proof needs remote credentials or
mutates a live deployment. CI runs the shared tooling once before builds, then
both e2e targets and actual CLI selections after foundation builds and Chromium
setup.

Three canonical provider proofs run once for the shared application across two
targets, separately from either framework's browser verification. The first
target runs approval followed by the backup-effect proof; the second runs the
trip-summary proof:

```sh
npx nx run native-conversation-react:provider-test
npx nx run native-conversation-react:summary-provider-test
```

They require `uv` and Python 3.12. The required library CI job installs Python
with the pinned `astral-sh/setup-uv` action and caching disabled, then runs the
two targets sequentially with a ten-minute limit each. Each runner copies the
canonical Python graph and lock into an owned
temporary directory, uses `uv sync --frozen --python 3.12`, and starts the pinned
LangGraph service with an explicit local model replay fixture. It compiles the
real application owner against the installed candidate packages and runs it in
Node without building either UI. The approval proof checks approve, decline,
loaded approval and
a separately labeled raw-session unmatched-ID routing diagnostic. The provider
proof records exact HTTP requests, associated saved tool results and the model
journal; browser fixtures alone do not establish this provider behavior. It
uses owned loopback ports, sanitizes inherited credentials and cleans up only
its own threads and processes. Unconfirmed creation or cleanup retains the
owned temporary directory and fails the target.

The backup-effect proof seeds three owned threads through exactly three explicit
SDK state writes before application admission. The application submits text and
uses its existing approval token; the canonical Python graph owns the checkpoint
inventory change and correlated tool result. Approval removes only the selected
row while preserving unselected and retained rows; decline preserves all rows.
Deleting the sole row saves an empty inventory, and a later explicit list and
fresh application both observe that empty state. Fresh owners restore the
literal saved ToolMessages without reexecuting tools. Setup writes are recorded
separately from application traffic; no application backup-state write is hidden
in the proof.

These are demo checkpoint effects, not physical storage deletion. A graph
Command does not establish external transaction atomicity, safe concurrent
mutation or cancellation rollback. Cleanup confirms synchronous application
retirement and completed known-thread deletion while the provider remains alive;
the application does not expose an awaited browser-disposal API.

The summary proof checks the fixed tool catalog, exact supplied arguments,
one terminal ToolMessage write and no automatic model continuation. A later
explicit user message sees the saved call/result pair; a fresh application
loads readable saved text without executing the tool. Separate controlled
transport cases hold an already committed provider acknowledgement while Stop
or selection closes the downstream request, and reject a write locally before
forwarding it. These distinguish committed state from an unforwarded write;
the injected local 503 is not a provider rejection. The deterministic replay
proves routing, binding and persistence with the pinned provider, not live-model
obedience or the ability to plan an itinerary. All three proofs preserve exact
HTTP/model journals and require confirmed cleanup before accepting evidence.

The view proof checks that removing the view releases only its subscription,
the owner still receives a held response while absent, remounting preserves
snapshot/Markdown and two completed summary-card identities without another
terminal write, and explicit owner disposal physically closes the stream.
Real Back/Forward navigation and synthetic pagehide checks do not
claim actual browser BFCache coverage.

## Working on the example

Each development session selects one framework and builds/installs its fixed
four local candidate packages (core, content, LangGraph and React or Angular)
once. Source edits use that same installed consumer and derived lockfile; they
do not reinstall packages. A configured browser document owns its application
and selected session; framework views borrow that owner.

Edits, additions and deletions in the selected `react/src`, `react/public`,
`react/index.html` or `angular/src`, `angular/public`, plus supported `shared`
source files, are mirrored into the owned consumer. React uses Vite; Angular
uses the installed Angular CLI development server. Design-token CSS is mirrored
too. Generated
`shared/browser-config.json` and `shared/tokens.css` are reserved; edit the
assistant environment or `libs/design-tokens/src/lib/tokens.css` instead.

Library sources, package manifests/lockfiles, build configuration, tooling and
other frozen inputs require a restart to rebuild and reinstall. A detected
frozen-input change stops the session with a restart diagnostic. Restart after
changing the endpoint, assistant or key as well. The installed strict TypeScript
watcher for React, or `ngc --watch --noEmit` for Angular, must be clean before
the ready URL appears. Angular also requires the latest CLI bundle to succeed.
Subsequent type/template and bundle errors remain visible; a browser refresh
alone is not a successful compiler check. The Angular checker covers newly
added source files even when they are not imported by the current entry.

With the pinned Angular toolchain, newly added static assets may remain
undiscovered, and deleting then recreating an imported module may leave the
CLI's cached missing-module error after the checker recovers. Restart the
development command for these cases: the new generation discovers the asset
and recompiles the restored module. Existing asset edits and rename-back
recovery are verified live. Treat new static assets and delete/recreate as
restart boundaries even on platforms where the vendor watcher recovers;
the proof does not require those vendor failures on every OS.

Ctrl+C or SIGTERM closes the session's proxy, source watchers and owned process
groups, then removes its temporary consumer. Startup/runtime failures follow
the same cleanup path. If child cleanup cannot be confirmed, the command reports
failure and retains temporary files for diagnosis. It does not stop unrelated
servers or reuse another session's directory.

## Conversation behavior

- Opening the page or following a conversation URL never creates a server
  thread. Only **New** requests creation. Selecting a conversation validates it
  and loads history before enabling Send.
- The directory loads at most 50 conversations. The title filter searches only
  those loaded rows; it is not server search or pagination. Use **Refresh** to
  request a fresh list. If that list includes the ready selected conversation,
  its heading adopts the returned title; the transcript and draft stay as they
  are, and a conversation missing from the list stays selected. Titles are not
  otherwise kept current. **Retry** explicitly retries a failed selection.
- **Stop** requests local cancellation and closes the local stream. It does not
  guarantee that the server run has stopped.
- If a creation response is lost, creation is shown as unconfirmed: a server
  thread may already exist. **Refresh before trying New again** to avoid creating
  another thread unknowingly.
- A single root `approval_request` with a nonempty reason and a lowercase
  32-character hexadecimal interrupt ID offers **Approve** and **Decline**.
  The reason is literal text. These explicit actions send ID-addressed
  `approved` or `denied` values, without adding a human message. The canonical
  graph uses assistant ID `chat`; another deployment must expose this same
  protocol to use these controls.
- Other pauses remain visible but unsupported. Any root pause blocks Send;
  selecting another conversation or using New remains possible. There is no
  generic resume editor, fork or automatic replay.
- A decision preserves the draft. Sending clears it only after local admission;
  changing the selected conversation also clears it. Same-ID refresh preserves
  it. Ctrl/Cmd+Enter sends exact text, except during IME composition; Enter adds
  a newline.
- Stop, interruption or an error during a decision leaves its outcome uncertain
  and consumes that local decision. The server may still be running. Controls
  do not automatically retry, reload or reinterpret that pause as permission
  to resend. A newly settled pause can offer a fresh explicit decision.
- Interrupt IDs are provider task identifiers, not remote compare-and-swap
  tokens: a task can reuse an ID at a later pause. Local decision tokens prevent
  stale UI actions within this owner; they do not establish cross-client or
  server-side atomicity.

The fixed typed `show_trip_summary` catalog accepts an authored title, ordered
days and places, and an optional note. It formats a readonly supplied recap;
it does not plan, validate or change an itinerary. The handler returns readable
text with `followUp:false` independently of either view. Rendering never executes
or acknowledges the tool. The typed catalog narrows tool-call observations;
unknown tools' saved ToolMessage text remains readable as literal text.

There is no argument validator or schema engine. Normal string/array/number
formatting operations use the authored TypeScript contract; malformed values
can throw and become ordinary tool errors with no partial card. Metadata may
describe positive integral days, but formatting does not enforce that domain.
Completed local calls render one card at their assistant row, including empty
lists and repeated labels. Pending and failed calls remain ordinary observations.

A locally completed card does not mean its result is saved or the response has
completed. The composer reports the active, failed or completed operation. If a
terminal write acknowledgement is lost, the provider may already have committed
the result. Stop and navigation close local work without promising rollback,
automatic retry or model continuation. A new application restores saved results
as readable ToolMessage text, without reconstructing rich cards or executing
tools. An unresolved saved call may remain a pending observation. An explicit
new submit can still be refused while the existing session has an unresolved
terminal write.

Arbitrary generated tools/UI, directory mutations beyond create, AG-UI
persistence, canonical-mode cutover and package retirement remain later work.

## Retain and review a verified build

The default verification command removes its owned production output, installed
consumer and proof resources after completion. To retain the exact checked
artifact, choose a **new directory** under an existing real parent directory:

```sh
node examples/chat/native/tooling/verify.mjs --retain /tmp/native-conversation-review
node examples/chat/native/tooling/verify.mjs --review /tmp/native-conversation-review
node examples/chat/native/tooling/verify.mjs --framework=angular --retain /tmp/native-angular-review
node examples/chat/native/tooling/verify.mjs --review /tmp/native-angular-review
```

Fresh verification and retention accept `--framework=react` or
`--framework=angular`; omitting it selects React. Review infers the framework
from the verified artifact and rejects a framework flag. Unknown or duplicate
flags and combining retain/review are rejected. Retention never overwrites an
existing directory. The existing parent is resolved to its
physical path. The target must be new, and retained artifact paths cannot contain
symlinks. Capture is
provisional until the build and proofs pass; failures remove the newly owned
capture. Successful retention preserves checked app assets, source/configuration
and package evidence, compiler/bundler provenance, results and the separate view
proof. Temporary installation/build workspaces are still removed.

Review validates complete byte inventories, selected framework/package/compiler
evidence, app/view input agreement and successful verification results. It
requires all eleven production cases, including the eight-request approval case
and its literal-text, keyboard, draft, repeated-pause, physical-cancellation and
mobile-layout facts. It also requires the nine-request summary persistence and
restoration proof, the eight-request failed-write proof, and the six-request
actual view lifecycle with two preserved card identities and exactly one
terminal write. Missing or contradictory material evidence fails review. It serves
immutable copies of the checked bytes. These hashes establish local
integrity, not authenticity or a replayable build-tool installation. Review does
not rebuild or install anything, and it uses a deterministic local fixture,
not `NATIVE_LANGGRAPH_URL`. Its finite seven-request walkthrough is:

1. Open the printed URL once and select **Conversation A**.
2. Inspect the saved heading, list and table.
3. Send exactly `Show the proof.` and inspect **Verified response**.
4. Click **Refresh**, select **Conversation B**, and wait for **Saved B**.
5. Press Ctrl+C to print whether all seven expected requests were verified.

Start a fresh `--review` process for each browser walkthrough. Closing review
stops only its owned servers and leaves the retained directory intact. Keep or
remove that directory yourself after review; use development serving above for
an interactive session against a live endpoint.

## React message actions

Assistant answers expose the installed private `MessageActions` view. Copy writes
the exact answer text through the browser Clipboard API only after explicit
activation; reasoning and tool cards are excluded. The application owns pending,
success and failure feedback. Pending blocks repeats, including while the source
changes; completed feedback applies only to the captured text and generation.
Unavailable or rejected clipboard access reports failure without a legacy fallback.
`native-conversation-react:copy-test` covers source replacement and late settlement;
the installed production browser proof stubs every clipboard write and checks
keyboard use, remounts, preserved drafts and no extra conversation requests.
Ratings and regeneration remain separate application capabilities.
