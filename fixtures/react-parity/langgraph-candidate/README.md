# Real LangGraph candidate package review

This test-only candidate packages the actual private `createSession` factory and
its complete reachable JavaScript and declaration graph. It uses the unchanged
`@threadplane/langgraph` name/version in a temporary private manifest. It does not
change the published Angular package root, create a permanent migration API or
authorize publication.

Build the existing prerequisites, then run the complete isolated proof:

```sh
NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,content,angular,react --skip-nx-cache --outputStyle=stream
node scripts/react-parity/verify-langgraph-candidate.mjs
```

Ordinary TypeScript emits the 29 local modules and their 29 declarations into an
owned temporary directory. The manifest points directly at the real factory;
there is no generated facade or private backend bundle. Local tarballs supply
core, the candidate and each framework. SDK 1.10.0, its mandatory LangChain core
1.2.9 peer and their vendor dependencies follow the root lock's nested resolution.
The proof inspects installed package bytes separately from the runtime import
graph and browser bundle. Optional React peers do not make Node or Angular
candidate installations depend on React. Vendor validation dependencies remain
real dependencies; this is not an SDK-only footprint claim.

Strict installed NodeNext and browser-compatible checks use the complete actual
declarations with `skipLibCheck: false`. The SDK and LangChain stream declarations
require the `ESNext.Disposable` type library in addition to ES2022 and DOM.
Only generated candidate consumer configurations add that library. It does not
provide a polyfill or establish browser disposal, SSR or hydration support.
The pinned protocol dependency itself exposes a vendor `.ts` type entry; it stays
external and is not copied into the candidate's emitted local graph.

Executable relative imports use `.js`. Six declaration-only edges shared with
the current Angular package use `.d.ts`: TypeScript resolves these to their real
`.ts` sources, while ng-packagr resolves the emitted declarations in its memory
cache. Two mixed imports are split to keep those declaration edges out of
JavaScript. Both the ordinary Angular package build and strict installed
NodeNext/browser checks verify this compatibility; no output is rewritten.

Plain Node verifies inert import, construction, subscription and disposal with a
fetch spy installed before import. Both installed framework applications then run
all 27 existing main, tool, thread and checkpoint scenarios with their independent
wire, handler, cancellation and ownership checks. The candidate entry returns the
factory's inferred type. The original framework-only private bundle/declaration
verification remains a separate required gate.

To keep verified artifacts for manual review, choose a new directory:

```sh
node scripts/react-parity/verify-langgraph-candidate.mjs --retain /tmp/threadplane-langgraph-candidate
node scripts/react-parity/verify-langgraph-candidate.mjs --review /tmp/threadplane-langgraph-candidate
```

The second command checks the frozen tarball and served file hashes and starts a fresh React
and Angular loopback server pair without rebuilding, installing or opening a
browser. Follow the main view's full sequence: Load three times, then Send → Tool
→ Error → Hold → Stop → Pause → Stop → Resume → Resume → Drop → Reconnect → Send
→ Unmount → Dispose, followed by all three disposed commands. Tool shows the exact
root weather arguments and real handler result. Use `/?threads` and
`/?checkpoints` for the separate fixed-thread and checkpoint sequences printed in
those views. Reload does not reset server counters. Restart `--review` for another
complete walkthrough. Ctrl+C closes only the owned servers; retained files stay.
Run that review command twice for two independent server pairs, such as separate
Chrome and in-app browser walkthroughs. Manual servers do not print HTTP closure
statistics; exact request and held-stream abort evidence comes from the automated
27-scenario proof against the same retained application bytes.

`provenance.json` records the checked source hashes, complete emitted files,
tarball hashes, installed versions/footprints, actual resolved type inputs,
backend/application import graphs, scenario names and served file hashes.
Prebuilt framework tarball hashes identify the actual installed bytes; Git HEAD
alone does not prove artifact freshness. The ordinary `review-runtime.mjs` command
still composes private backend source and cannot establish candidate-package
provenance.

This proves the current private owner's package shape and existing capabilities.
Its optional custom transport declarations still include legacy queue operations;
the session does not thereby implement queueing or arbitrary external-run joins.
Thread-directory migration, public root cutover, feature retirement, provider
compatibility, SSR and releases remain outside this proof.
