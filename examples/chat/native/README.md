# Native conversation example

This private React example uses the installed native LangGraph runtime with
Threadplane's React bindings, owned Markdown and plain tool observations. It
opens saved conversations, restores their history and streams new responses.
It is a contributor example, not a published package or a replacement for the
canonical Angular chat example.

## Setup and commands

Run commands from the repository root using **Node 22 and npm 10**. Install the
root lockfile without updating dependencies:

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
export NATIVE_ASSISTANT_ID='your-assistant-id'
npx nx serve native-conversation-react --configuration=development --port=4301
```

Open the ready URL printed by the command, normally
`http://127.0.0.1:4301/`. The upstream must be an HTTP(S) URL without embedded
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
npx nx build native-conversation-react --configuration=production
npx playwright install chromium
npx nx e2e native-conversation-react
node examples/chat/native/tooling/verify.mjs
```

The tooling target runs import-safe Node tests without building or installing
an app. The test and build targets prepare isolated consumers from locally
built candidate tarballs and the root lockfile, using exact `npm ci`
installation. They compile against those installed declarations and runtimes.
The build publishes to `dist/examples/chat/native/react`, including provenance;
it replaces previous output only after successful compilation and validation.
Failed preparation preserves the previous valid build and removes owned
temporary files.

The e2e target runs development, basic conversation and production cases against
owned local fixtures. The production case contains eight browser scenarios and
a separate React view removal/remount proof. The actual verification CLI also
builds production output, runs the installed owner tests, then checks those
production scenarios and view lifecycle. Neither proof needs remote credentials
or mutates a live deployment. CI runs the tooling target before builds, then
the e2e target and actual CLI after foundation builds and Chromium setup.

## Working on the example

Each development session builds and installs a fixed set of candidate tarballs
once. Edits, additions and deletions in `react/src`, `react/public`,
`react/index.html` and supported `shared` source files are mirrored into that
installed consumer for Vite updates. Design-token CSS is mirrored too. Generated
`shared/browser-config.json` and `shared/tokens.css` are reserved; edit the
assistant environment or `libs/design-tokens/src/lib/tokens.css` instead.

Library sources, package manifests/lockfiles, build configuration, tooling and
other frozen inputs require a restart to rebuild and reinstall. A detected
frozen-input change stops the session with a restart diagnostic. Restart after
changing the endpoint, assistant or key as well. The installed strict TypeScript
watcher must be clean before the ready URL appears and reports subsequent type
errors in the terminal; a Vite refresh alone is not a successful type check.

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
  request a fresh list. **Retry** explicitly retries a failed selection.
- **Stop** requests local cancellation and closes the local stream. It does not
  guarantee that the server run has stopped.
- If a creation response is lost, creation is shown as unconfirmed: a server
  thread may already exist. **Refresh before trying New again** to avoid creating
  another thread unknowingly.
- Paused responses are shown as paused; resuming them is not supported.

Plain Markdown and tool observations are supported. Generated tools/UI, rich
rendering, directory mutations beyond create, AG-UI persistence, canonical-mode
cutover and package retirement remain later work.

## Retain and review a verified build

The default verification command removes its owned production output, installed
consumer and proof resources after completion. To retain the exact checked
artifact, choose a **new directory** under an existing real parent directory:

```sh
node examples/chat/native/tooling/verify.mjs --retain /tmp/native-conversation-review
node examples/chat/native/tooling/verify.mjs --review /tmp/native-conversation-review
```

These are the complete CLI forms; do not combine them or add flags. Retention
never overwrites an existing directory. The existing parent is resolved to its
physical path. The target must be new, and retained artifact paths cannot contain
symlinks. Capture is
provisional until the build and proofs pass; failures remove the newly owned
capture. Successful retention preserves checked app assets, source/configuration
and package evidence, compiler/bundler provenance, results and the separate view
proof. Temporary installation/build workspaces are still removed.

Review validates the retained inventory and serves its checked bytes. It does
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
