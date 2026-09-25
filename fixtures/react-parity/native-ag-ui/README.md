# Native AG-UI owner review

This fixture mounts Angular and React in the same document over one actual private
AG-UI session. A second React view observes an independent session. It uses locally
compiled framework bindings and bundles private AG-UI source; it is not an
installed or publicly exported backend package.

Both compiled `/chat` entries render root text beside the full protocol panels.
The private pure selector includes root user/assistant text and multipart user
text parts joined by newlines. It omits child text (including `Hello`), reasoning,
tools and activity from that view while preserving all native request history.
`First`, then root `Next answer`, appear in both conversation views.
Status is separate from the rows and follows only observed run facts.

From the repository root, build the prerequisites once:

```sh
NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,angular,react --skip-nx-cache
```

Start a manual review:

```sh
node scripts/react-parity/review-native-ag-ui.mjs
```

The command prints an ephemeral `127.0.0.1` URL, the sequence, and JSON provenance.
It never opens a browser automatically. Keep it running while reviewing. Ctrl+C
or SIGTERM closes only this invocation's server and connections.

Use each enabled control in order:

1. **First** submits `model: review-small`, `reasoning_effort: low`, and
   `gen_ui_mode: inline`. A server delta replaces that submitted effort with
   `high` and adds `count: 1`, alongside a worker start and raw partial arguments.
   Both diagnostic views show a literal `legacyInterrupt` notice and no terminal;
   the response remains open in the default native mode.
2. **Remove React**, then **Advance first**. Angular receives the completed weather
   arguments, tool result, `Hello`, an authoritative snapshot containing only
   `count: 2`, a suspended child, and a native root interrupt terminal. Angular
   retains the earlier custom notice beside that terminal.
3. **Mount React** reconnects observation without a request and displays both the
   retained notice and native terminal.
4. **Resume** uses the observed native pause token and an explicit resolved
   `approval` response with payload `{ approved: true }`. It sends full prior native
   history and `count: 2`, adds no user row or settings patch, then shows root
   `Next answer`. The diagnostic decision contains the captured running attempt.
5. **Remove Angular**, then **Complete resume**. React receives successful
   completion and the decision clears at local settlement.
6. **Mount Angular** reconnects observation without a request.
7. **Start other** shows independent B state `count: 99`.
8. **Cancelable** shows A state `count: 3` while B stays active.
9. **Stop A** closes A's response while B stays active.
10. **Dispose** closes both owners. **Try disposed** returns `aborted` without a request
    or snapshot change.

Only the next control is enabled; pending transitions reject rapid duplicate
clicks. Failures are visible and require a fresh review. Reload creates a new
review ID and new owners; it does not reset or erase another page's evidence.
Page teardown requests disposal. The server independently checks the four exact
request envelopes and records actual response closure. `/stats` retains every
review; `/provenance` identifies the served bundle.

Submitted settings are shallow patches admitted into the owner's local shared
document before dispatch. They supply the baseline for native deltas; later
server snapshots can remove them. Stop or failure retains admitted local data
without claiming remote persistence. The server's expected settings are fixed
independently of the request body.

Native custom notices are evidence, not terminal pauses or actionable decisions.
This fixture waits for the later native terminal. A notice-only native stream
ending at EOF would be `interrupted`; local cancellation can be `aborted` even
after terminal evidence was observed. Explicit private `legacy-observation` mode
retains the older close-at-notice convention but supplies no resume capability.
Any decision blocks ordinary submission. Only a settled unclaimed native pause
can be answered once with its current token; legacy notices cannot be resumed.
If an invoked resume fails, ends at EOF or is stopped without conclusive native
evidence, its retained attempt is uncertain and blocks replay and ordinary bypass.
Local stop or reconstructing an owner is not recovery. Separate held HTTP tests
cover these uncertain outcomes; this main walkthrough uses synthetic success.
No hosted provider resume compatibility is claimed.

The separate `scripts/react-parity/verify-native-mastra.ts` command exercises the
actual private owner against the pinned local Mastra service and a scripted model.
Its approval, rejection, cancellation and lost-terminal HTTP proof is documented
in `libs/ag-ui/src/runtime/README.md`; it adds no browser controls or hosted-provider
claim to this synthetic walkthrough.

For automated verification, use existing Playwright Chromium (install it once
with `npx playwright install chromium`, or `--with-deps chromium` on Linux):

```sh
node scripts/react-parity/review-native-ag-ui.mjs --verify
```

Verification drives visible controls, checks rendered native snapshots and shared
references, and requires all four verified requests to close **before** browser or
server cleanup. It fails on page errors, console warnings/errors, external network
requests, incorrect envelopes, or lifecycle mismatches. Both modes use the same
bundle and server. Node tests do not need built packages or Chromium.

Provenance includes sorted hashes of transitive local bundle inputs, compiled
binding implementations, fixture/server/runner files, the lockfile and its locked
versions, scoped tracked/untracked changes, Git HEAD, and final bundle bytes. These
locked versions do not assert that this invocation installed dependencies. HEAD
alone does not establish artifact freshness. Build again after changing bindings.
No temporary bundle tree is retained.

This deterministic synthetic fixture does not establish hosted-provider parity,
public backend exports, rich component parity, tool execution, persistence,
provider resume interoperability, SSR or hydration. It retains raw protocol arguments without
parsing them or fabricating executable core tool states. Public documentation
and generated agent context remain unchanged.
