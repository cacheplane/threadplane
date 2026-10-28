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

React trip recaps use the application-authored custom catalog
`urn:threadplane:native:trip-summary:v1`. For associated completed typed tool
calls, the application owns one private `createA2uiSurfaces` instance per
assistant message ID and delivery generation. It applies literal A2UI v0.9
descriptions with root `root` and seven component types: `Trip`, `Counts`,
`Days`, `Day`, `Places`, `Place` and `Note`. Strict application validation and
raw snapshot projection produce a frozen `@threadplane/react/render`
`RenderSpec` with direct props, static children and empty state. The existing
authored registry renders one card per call, preserving order, duplicate labels,
empty lists and literal text.
The view borrows prepared descriptions; it does not parse tool arguments,
apply raw commands or own render actions or effects. Angular retains its
existing supplied-card presentation.

Shared content still owns Markdown, reasoning and tool association. React's
raw owners survive StrictMode, unmounting and updates while the view is absent;
selection retirement, generation replacement and application disposal release
them once. If validation, raw application or projection fails, the last combined
snapshot remains visible and all raw owners are disposed. Identical complete
input can rebuild fresh owners. Initial failure becomes a selection error;
later publication failures are contained without automatically issuing commands.
This is completed typed-tool data authored by the application, not generic
wire-message classification or a generic A2UI interpreter. Arbitrary data-model
bindings, the basic catalog, forms, actions, functions, templates, URLs,
protocol parsing, readiness and public catalog registration remain outside this
example.

React assistant rows compose `Citations` from explicitly supplied message
metadata. Sources preserve their order, indices and literal title/snippet/type
text; links use the shared Markdown URL policy. The view does not fetch metadata
or icons. Installed production checks cover restored sources, same-ID metadata
updates, unsafe URLs, literal text and narrow-screen wrapping.

The React view also composes `TextTranscript` in app-authored background activity
disclosures for supplied child observations. Full namespace tuples identify
disclosures internally; visible labels use ordinals. Child messages remain literal
text in their own transcript, with supplied response-request and protected error
notices. These observations offer no child response or tool commands and infer no
child lifecycle status. Installed checks cover root isolation, local stop retaining
observations, and a new independent submission clearing them.

The React view composes `MessageList` with a stable authored row renderer and
`ChatInput` with the application's existing submit/stop commands. Its bounded
transcript follows updates only while pinned to the bottom. Conversation changes
reset the list; a title refresh keeps its DOM and scroll position. The React-only
production scroll test covers these behaviors against installed candidates.
Where `ResizeObserver` is available, one observer watches the content wrapper and
scroll region to follow disclosure growth and viewport resizing while pinned.
Readers above the bottom keep their position; without the observer, row-update
following remains available. The installed proof checks both resize directions,
repinning, and retained region/row identity.

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

The React loaded-conversation directory uses the installed private `ThreadList`
view for its selection rows in page, popup, sidebar and sidenav presentations.
The application still owns the supplied order, loaded-title filtering, selection,
Refresh commands and all status/empty text. Its optional New action delegates
to the same application creation owner, with only that action disabled while
creation is pending. The application still owns creation and resulting selection.
The list issues no commands on mount or rerender. Retained rows keep their button DOM through navigation modes;
the existing deliberate composer reset still applies when selecting another
conversation. Other thread lifecycle actions and full T29 parity remain open.

The full React directory also uses `renderActions` to place an application-owned
controlled `OverflowMenu` beside each selection button. Its full Actions label
identifies the row; opening it exposes the full Copy conversation ID item. Explicit
item activation copies the exact row ID through that item's document clipboard, with pending,
success and failure feedback, both visible and announced, and retry after failure.
Copying does not select a conversation or issue backend commands, and retains the
draft and active response.
Pending disables only the copy item. The Actions trigger remains focusable and
accepted selection closure returns focus before the clipboard promise settles;
reopening shows a disabled pending item. Arrow/Home/End navigation, native
Enter/Space, Escape before drawer dismissal, Tab/Shift+Tab and outside dismissal
belong to the private menu. The app owns open state, clipboard execution and all
feedback. Portals retain local theme/font/direction and suppress unavailable
anchors during retained navigation collapse or drawer closure.
Right-clicking a full-directory selection row opens the same command at the
pointer; the Context Menu key and Shift+F10 open it from the focused row. Opening
does not select, copy, or fetch. Escape and accepted command closure return focus
to that row, while Tab continues from its natural order. Ordinary Actions-button
activation retains its trigger-based behavior. The application associates each
request with its own identity, preventing an old close callback from dismissing
a newer request even when the conversation ID is reused. Filtering a row out
invalidates its request. Typeahead and further lifecycle/project commands remain open.
The compact sidenav rail retains selection-only rows. Clipboard access may be
unavailable or denied by the browser; the example reports that failure locally.

The full directory's Actions and row context menus also offer Rename. The
installed controlled `ThreadRenameForm` supplies a labelled inline title editor,
Save, Cancel, IME-safe Enter and Escape. Opening or cancelling it makes no
backend request. The application trims nonempty changed titles and writes only
that exact thread's `metadata.title`, with no automatic retry or implicit read.
Success requires the returned ID and actual title to confirm the requested
mutation; missing or mismatched evidence is reported as failure. Errors retain
the entered title for explicit retry. Successful renames update the row and
matching selected heading while retaining the session, draft and active response.

Pending Save is reserved by target ID and disables duplicate submission.
Cancel/Escape may close the editor while a request is pending; the reservation
remains until settlement and the UI makes no rollback promise. Reopening that
target reflects pending state. Late confirmation can reconcile acknowledged
metadata, but an old editor cannot dismiss, rewrite or focus a replacement.
Stale directory reads cannot overwrite an acknowledged title; a later explicit
refresh remains authoritative. The compact rail remains selection-only.

Native React uses the list's bounded `renderTitle` callback to highlight the first
literal case-insensitive match for the trimmed loaded-title filter with `mark`.
Blank queries and absent matches preserve the plain original title (or full ID).
Source text and React escaping remain intact, including Unicode case expansions.
The callback supplies noninteractive phrasing content only; the original full
label and timestamp description remain accessible. The library honors `null` and
`false` output without fallback. Broader row templates, lifecycle, project,
search and history surfaces remain open; this is no public release or full T29 claim.

The shared directory projection copies only `metadata.pinned === true` into an
optional readonly boolean `pinned: true`; false, missing and invalid values are
omitted. React presents a decorative current-color pin
plus an accessible “Pinned conversation” description before relative time. The
original name and tooltip remain intact, including highlighting
and pin toggles on Refresh. The controlled ThreadList preserves supplied order;
the application owns mutation. Native full-directory Actions and row context
menus offer Pin for unpinned rows and Unpin for strict `true`, with visible and
announced pending, success and failure feedback. Explicit activation writes only
`metadata.pinned`, with no automatic retry or implicit refresh. Success requires
the exact returned ID and raw boolean, including explicit `false` for unpin.
Failed or unconfirmed requests retain prior state and permit explicit retry.
Only the pending pin item is disabled; Copy, Rename and selection remain usable.
Confirmed pin state updates the shared full and compact row presentations without
session replacement, navigation, draft loss or interruption of a response.
Independent title/pin/archive reconciliation preserves concurrent renames and newer
authoritative reads, including delayed list, lookup and history responses.
The native application groups active pinned rows first, sorting finite numeric
`metadata.pinnedOrder` ascending with stable ties and unranked pins last. Unpinned
rows retain supplied relative order. Full and compact directories apply the loaded
title filter after this ordering. Angular also receives this optional metadata
through the shared projection; row templates remain future work.

Active pinned menus offer Move up/down within the complete loaded pinned slice,
including rows hidden by the title filter. Boundary commands are omitted. Moves
restamp that captured slice with nonnegative integer ranks, writing only changed
`metadata.pinnedOrder` values. This is bounded to at most 50 loaded conversations,
not a server-wide or atomic transaction. Exact confirmation is required for every
write. A partial failure retains the last known local order and requires an explicit
successful Refresh admitted after settlement before another move; remote partial
updates may exist. There is no automatic rollback, retry or implicit refresh.
Only move commands are blocked globally while pending or unconfirmed; Copy,
Rename, Pin/Unpin, Archive, selection and submission remain available. Directory-owned
feedback includes the target title and ID, survives filtering and row movement,
and does not replay settled outcomes after remount. Pending and unconfirmed recovery
state survives remount. Open row menus expire when visible positions change;
same-position metadata updates retain their owner. Moves preserve keyed row DOM,
selection, draft, session and the running response.

Native React also composes reversible Archive and Unarchive in its full directory.
Only strict `metadata.archived === true` classifies ordinary loaded rows as archived.
The existing Loaded conversations list and its New action contain active rows;
Archived conversations expands a separate Archived loaded conversations list with
no New action. Archived rows retain supplied order; active rows use the pinned-first
ordering described above. Both share the loaded-title filter. These are at most 50 loaded rows, not a backend-wide archive search.
The compact rail contains active rows only; expand navigation to restore archived
rows. Active menus offer Copy, Rename, Pin/Unpin and Archive; archived menus offer
Copy and Unarchive.

Explicit activation patches only exact-target `metadata.archived`, with no retry
or implicit read. Both true and false require the exact raw returned ID and boolean
before classification changes. Failed or unconfirmed writes keep the row in place
and allow explicit retry. Per-target pending state survives filtered rows and view
remounts; only that lifecycle command is disabled. Visible announced feedback
includes the target title and ID and belongs to the stable directory owner, so
confirmation remains readable after row migration. Historical completions are not
replayed on remount, and late completions do not focus or close replacement views.
Concurrent title, pin and archive confirmations preserve independent fields;
prewrite reads cannot undo confirmation and newer authoritative reads can supersede it.

Archiving or restoring a selected conversation changes directory classification
only. The selected transcript, composer draft, session and running response stay
mounted and selected, with no reload, stop or navigation. Archived rows remain
selectable. This deliberately differs from the Angular demo clearing selection
when it archives. Project actions, drag reordering and full thread lifecycle/T29
parity remain open; the ThreadList row API is unchanged.

Native React full directories also compose permanent Delete through the private
controlled `ConfirmDialog`. Active menus keep Archive last; archived menus offer
Copy, Unarchive and Delete. Compact rails remain selection-only. Confirmation
captures the literal title and ID, warns about permanence and a selected draft,
and defaults to Cancel. Cancel, Escape and backdrop dismissal make no request.
Confirm closes the modal before dispatch; it does not offer cancellation or rollback
of an admitted remote deletion. Selected running or retained reconnect evidence
requires resolving the current run before deletion.

Only an exact-target HTTP 204 or a fresh explicit status inspection returning 404
retires a row. Pending or unconfirmed deletion keeps rows and selected content,
blocks another delete and reordering, and blocks the target's metadata and composer
writes while leaving other conversations' actions usable. Shared pending/recovery
feedback survives filtering and remounts. Use **Check deletion status** explicitly:
an exact-ID 200 restores writes without replacing the selected session or draft;
404 retires it. Refresh never confirms deletion, and no automatic read or DELETE
retry occurs. Confirmed IDs stay retired for the application owner's lifetime,
including stale later reads. Deleting a nonselected conversation preserves the
selected draft and running response; confirmed selected idle deletion clears only
the still-matching selection, session and route. This is bounded private T22/T29
composition, with no full overlay-stack or thread lifecycle parity claim.

The shared directory projection copies valid backend `updated_at` strings into
immutable optional epoch-millisecond `updatedAt` fields. Native React passes these
rows directly to the installed list, which renders relative time and an exact ISO
instant while preserving each button's title-based accessible name. Invalid or
missing backend timestamps omit metadata. Relative labels use the render-time
clock; explicit application Refresh and creation outcomes supply new timestamps.
There is no periodic timer or background request. Angular receives the optional
row field through the shared projection and retains its existing title-only UI.

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
frameworks without building or installing an app. It uses the existing `tsx`
dependency explicitly to load the authored Vite TypeScript configuration instead
of relying on Node's default TypeScript stripping. The test and build targets
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
That original lifecycle records six requests and one terminal write. A separate
React lifecycle records nine requests and two writes: a held completed-summary
response creates raw surfaces while the view is absent, remount preserves the
same prepared descriptions and raw owner. Navigation retires the first owner;
an explicit recap request in another conversation completes a tool call with
the same assistant message ID and a new delivery generation, creating the
second owner. Loading history does not reconstruct rich cards. Both owners
are disposed exactly once. The React app and view proof use the same production
application factory, catalog and snapshot projector against
installed candidate packages; the extra observation helper is proof-only.
Real Back/Forward navigation and synthetic pagehide checks do not
claim actual browser BFCache coverage.

## Working on the example

Each development session selects one framework and prepares its fixed installed
candidate profile once. Native React build, serve and default tests use five
packages: core, content, A2UI protocol, React and LangGraph
(`react-native-a2ui-langgraph`). Native Angular uses four: core, content, Angular
and LangGraph (`angular-langgraph`). The explicit ordinary React shared-test
profile still uses four packages without protocol declarations. Separately,
each isolated foundation build runs four ordered library builds: core, A2UI
protocol, content, then the selected binding. Installed package counts do not
count these build steps. React consumes protocol declarations; neither native
production bundle includes protocol JavaScript. Source edits use that same
installed consumer and derived lockfile; they do not reinstall packages.
A configured browser document owns its application and selected session;
framework views borrow that owner.

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

The tool handler has no argument validator or schema engine. Normal string/array/number
formatting operations use the authored TypeScript contract; malformed values
can throw and become ordinary tool errors with no partial card. React separately
validates its authored literal surface before projecting a raw snapshot; this
does not validate arbitrary tool input or enforce itinerary rules. Metadata may
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

Arbitrary generated tools/UI, directory mutations beyond create/rename/pin/archive/pinned order, AG-UI
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
terminal write. React additionally requires the separate nine-request,
two-write raw-owner lifecycle, installed raw implementation and declaration
evidence, and matching production app/view inputs. Missing or contradictory
material evidence fails review. It serves
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

## React popup and sidebar presentations

Add `?presentation=popup` to the native React example URL to keep the loaded
conversation directory on the page and show the selected conversation in the
installed private `ChatPopup` composition. Use `?presentation=sidebar` for the
full-height private `ChatSidebar` instead. Its directory uses the persistent page
slot, with “Keep page beside chat” enabled initially. On wider screens this
reserves room beside the open panel; disabling the checkbox restores overlay
mode. At 640px and below the panel always overlays at full viewport width with no
reserved page space. Its launcher hides while open. Both modes use the
same selected application and conversation view. The default presentation stays inline;
unknown presentation values also use the page layout.

The application owns the open state. Closing hides the same mounted conversation,
preserving its unsent draft, content owners and subscriptions. Responses continue
while hidden; opening and closing send no conversation commands. Stop and changing
the selected conversation retain their existing meanings. The Close button and
Escape inside the panel request closure, focus returns to the launcher when
appropriate, and Tab
can leave this non-modal dialog for the surrounding page.

`npx nx e2e native-conversation-react --grep 'installed React (popup|sidebar)'` verifies the installed
production component against an owned local HTTP/SSE fixture, including hidden
completion, retained DOM/draft, keyboard access, a hidden open-sidebar launcher,
desktop geometry, layout preference changes, RTL placement, the 641px/640px
boundary, and 390px/600px layouts with reachable Close and Send. Layout changes
retain the directory filter, composer and active response without extra requests.
It does not use a live model. These are bounded compositions, not complete Angular
popup/sidebar/sidenav parity or a published package.

## React conversation navigation presentation

Exact `?presentation=sidenav` opts into the installed private `ChatSidenav`
shell around the existing loaded-conversation directory. The selected
conversation stays inline. Desktop navigation can expand to 18rem or collapse
to 4rem; at widths of 700px and below the application chooses a non-modal
inline-start drawer, at most 20rem wide, with the optional sibling
`ChatSidenavScrim` backdrop. Navigation remains non-modal with no focus trap. Returning to
desktop restores the previous expanded/collapsed choice. The default and unknown
presentation values retain the page layout.

The application owns mode, drawer visibility, selection, filtering, Refresh and
New. Breakpoint changes and accepted conversation selection close the drawer.
Closing, expanding, collapsing and resizing retain the same directory filter,
composer DOM and unsent draft, and send no conversation commands. An active
response continues through these navigation changes. Selecting a different
conversation retains the existing deliberate composer draft reset.

Desktop navigation opts into Ctrl+B or Command+B to request expanded/collapsed
mode. The toggle exposes the shortcut through `aria-keyshortcuts` and its action
tooltip. Filter, composer and other editable fields keep their normal keyboard
behavior; drawer mode, composition, repeats, Alt/Shift-modified chords and
already handled events leave the chord unclaimed. The shortcut retains the same
draft, directory and active response and sends no conversation command.

Search loaded conversations and the opt-in Ctrl+K / Command+K shortcut reveal
the existing directory and focus its loaded-title filter. Desktop search expands
the rail; drawer search opens navigation while preserving the remembered desktop
mode. Normal launcher activation still focuses Close. Repeated explicit search
requests can refocus the filter; streaming and unrelated renders do not. Filter
text, composer draft, selected conversation and active response remain owned by
the same application, with no new requests or backend search. Editable fields and
already handled or excluded chords retain their normal keyboard behavior.

The drawer launcher, Close, scoped Escape and backdrop activation request controlled changes; focus
moves only after accepted visibility/mode changes. Hidden directory content is
inert, and Tab can reach the surrounding page. Focus returns to the launcher when a focused backdrop is dismissed,
or to the desktop toggle when a breakpoint removes it; an already focused page
control retains focus. The backdrop covers page pointer targets while open.
The compact rail uses the private `ThreadList.renderItem` full-row callback to
return an application-owned `CompactThreadRow`. It owns the exact-ID selection
button, full accessible name and tooltip, active state, decorative initial/pin and
semantic timestamp description. Default full-directory action/title renderers are
not called for these rows. Custom rows preserve the existing compact geometry,
loaded filtering/order, draft and running response; they add no backend requests.

The compact rail composes a second `ThreadList` from the same filtered rows,
active ID and application selection callback. It shows the uppercase first Unicode
code point of the trimmed title (or ID), with `?` for empty content, while keeping
full accessible names, tooltips and pin/time descriptions. It has no extra New,
filter or Refresh controls. The full directory remains mounted; compact rows
remain mounted and hidden/inert when expanded or in either drawer state.
This bounded composed
navigation does not implement Angular project menus, backend search, search dialogs or other global shortcuts,
debug ownership or full T30 parity. Popup and sidebar remain separate
presentations.

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

### Loaded project navigation (private React T29 slice)

`ProjectList` from `@threadplane/react/chat` presents a readonly supplied
`ProjectListItem[]` (`id`, `name`) with controlled `activeProjectId` and
`onSelect(projectId)`. It preserves supplied order and exact IDs, renders names
as literal text (empty names fall back to ID), and marks the active button with
`aria-current`. `label` and `className` customize the list. Optional
`onNewProject`, `newProjectLabel` and `newProjectDisabled` expose an application-owned
request; the primitive performs no creation or persistence. Use unique project IDs.

Native React merges browser-local catalog entries with first-seen nonblank
`metadata.projectId` values among loaded conversations, including archived rows.
IDs retain their exact bytes; local names fall back to IDs when not saved in this
browser. Selecting a project filters active, archived and compact rows alongside
the existing title filter. All conversations resets only the project filter.
The selected transcript, draft and running response remain mounted without extra
backend calls. A disappearing project stays selected with an empty filtered view
until reset. New project is always available when local storage is healthy; the
larger project section appears for catalog/loaded entries, a retained filter or an
open editor. Selection is ephemeral, while names persist only in this browser.
New conversations remain unassigned, and pinned reordering still spans all loaded
pins, including other projects. Deletion, association writes/move-to-project and
full T29 parity remain open. See the naming slice below for persistence behavior.

### Project creation and browser-local names (private React T29 slice)

`ProjectList.renderActions(project)` receives the original readonly item and
composes application-owned controls beside selection. Absent/null/false/undefined
output omits the action wrapper. Commands do not implicitly select a project.
`ProjectNameForm` is a controlled editor with `value`, `onValueChange`, `onSubmit`
and `onCancel`; optional `label`, `className`, `submitLabel`, `pending`,
`submitDisabled` and `error` customize presentation. It focuses/selects once,
protects IME input and blank/pending/disabled submissions, and never saves on blur.
Persistence, request lifetime and return focus belong to the application.

Native React now creates and renames projects in the versioned browser-local
`threadplane-native-react-projects-v1` catalog. It displays local catalog entries
first, then first-seen loaded association IDs without duplicates. Renaming a loaded
ID imports its name locally without changing the ID or backend metadata. Names
are trimmed on Save; duplicate names are allowed because IDs define identity.
Catalog-only projects can be selected with an empty conversation view. New
conversations remain unassigned. These are local labels, not a shared server catalog.

Writes reread and validate the current catalog and publish only after persistence
succeeds. Malformed/unsupported saved data is never replaced; unavailable storage
and write failures keep the draft and target, expose Retry, and block submission
until recovery. Retry reloads without committing. Storage events (including clear)
refresh names without broadening a retained filter or replacing an active draft.
This uses browser localStorage's last-writer-wins behavior, not atomic multi-tab
transactions. No cross-device sharing or backend project commands are introduced.
Project selection, naming and persistence preserve the selected conversation,
transcript, composer draft and running session without extra network calls.
Project deletion, association writes/move-to-project and full T29 parity remain open.
