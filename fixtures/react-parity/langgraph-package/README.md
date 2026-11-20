# LangGraph package proof

`@threadplane/langgraph` is a framework-neutral package: its root exports
`createSession` and the rest of the session runtime, and it contains no Angular
code. This proof packs the package the release publishes, `dist/libs/langgraph`,
installs the tarball into isolated consumers and runs them.

Build the packages, then run the proof:

```sh
NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,content,angular,react,langgraph --skip-nx-cache --outputStyle=stream
node scripts/react-parity/verify-langgraph-package.mjs
```

What it checks:

- **The build is current.** Every compiled module and declaration in
  `dist/libs/langgraph` equals a fresh compile of `libs/langgraph/src`, and the
  manifest is the project's. A stale `dist` fails instead of being packed.
- **The package shape.** A public ESM manifest whose root is `src/public-api`,
  peers on `@threadplane/core`, `@langchain/langgraph-sdk` and
  `@langchain/core` only, no dependencies, and the shared install hook. Every
  module imports only the package's own files, core and the SDK. A framework
  import fails even if a manifest were to declare the framework.
- **The tarball.** It holds exactly the staged files, and the installed bytes
  equal the tarball's.
- **Plain Node.** Import, construction, subscription and disposal make no
  request, with a fetch spy installed before import. The root's runtime exports
  are an exact list. Neither Angular, React nor RxJS is installed.
- **Installed types.** `installed-types.ts` is checked under NodeNext and
  Bundler resolution with `skipLibCheck: false`, against the installed
  declarations.
- **A React consumer and an Angular consumer.** Each installs its binding, core
  and this package from local tarballs, builds, and runs the existing main,
  tool, thread and checkpoint scenarios in a browser. The React consumer's
  dependency graph contains no Angular package, and the Angular consumer's no
  React package.

Local tarballs supply every Threadplane package. The SDK, its LangChain core
peer and their vendor dependencies follow the root lock's nested resolution;
the consumer names the two peers at the locked versions, as an application
would install them. The SDK and LangChain stream declarations need the
`ESNext.Disposable` type library in addition to ES2022 and DOM; only the
generated consumer configurations add it.

To keep verified artifacts for manual review, choose a new directory:

```sh
node scripts/react-parity/verify-langgraph-package.mjs --retain /tmp/threadplane-langgraph-package
node scripts/react-parity/verify-langgraph-package.mjs --review /tmp/threadplane-langgraph-package
```

The second command checks the frozen tarball and served file hashes and starts a
fresh React and Angular loopback server pair without rebuilding, installing or
opening a browser. Follow the main view's full sequence: Load three times, then
Send → Tool → Error → Hold → Stop → Pause → Stop → Resume → Resume → Drop →
Reconnect → Send → Unmount → Dispose, followed by all three disposed commands.
Use `/?threads` and `/?checkpoints` for the separate fixed-thread and checkpoint
sequences printed in those views. Reload does not reset server counters; restart
`--review` for another complete walkthrough. Ctrl+C closes only the owned
servers; retained files stay.

`provenance.json` records the checked source hashes, the staged files, tarball
hashes, installed versions and footprints, resolved type inputs, backend and
application import graphs, scenario names and served file hashes.

Other harnesses (the React cockpit builds, the native conversation tooling)
compile the same source into the same layout with `emitCandidate`, without a
prior `nx build`. Those packages carry the inert contributor install hook and
are never published.
