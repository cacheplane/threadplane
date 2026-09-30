# Real AG-UI candidate package review

This private packaging experiment emits the actual native owner and text
selector. A fixture entry directly forwards their real exports and types. The
temporary `@threadplane/ag-ui` package keeps version 0.2.0 and does not change the
published Angular package root or introduce a permanent migration API.

With the repository's existing dependencies available, build the prerequisites
and install the exact local service lock:

```sh
NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,angular,react --skip-nx-cache --outputStyle=stream
npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund
node scripts/react-parity/verify-ag-ui-candidate.mjs
```

The verifier emits 20 backend modules plus the direct forwarding entry, with
21 corresponding declarations. It packs into its own temporary directory and
installs real core, React, Angular and backend tarballs. The existing APF output
and framework-only SDK installation ban remain separate required checks. There
is no output rewrite, source alias, narrowed declaration or backend wrapper.

The pinned AG-UI client 1.0.1 uses real vendor dependencies, including RxJS and
Zod. The existing root npm override `rxjs: ~7.8.0` selects locked RxJS 7.8.2 despite
the SDK's raw 7.8.1 dependency declaration. The candidate records that supported
override, validates its effective range and checks the complete installed graph
against the root lock. Shared vendors receive exact top-level and recursive pins;
conflicting versions require review instead of flattening them. In particular,
the shared protobuf dependency remains 2.11.0. No dependency is upgraded.
The mixed consumer also pins and compares the complete owner-relative closure
of its framework and type-package roots, including scheduler, csstype and
undici-types. Package hoisting paths may differ; resolved versions and dependency
edges must match. The backend owner's vendor graph is recorded separately.

Plain Node verifies zero fetch attempts during import, construction, observation
and disposal. Strict NodeNext and browser checks use the full installed
declarations with `skipLibCheck: false`. Framework bindings retain the native
snapshot type. Core is required by those declarations; its implementation need
not occur in the backend's runtime graph.

The installed browser uses the same application and independent HTTP oracle as
the original native review: all 13 controls, two owners, both frameworks, child
text/tool observations, native resume, view removal/remount, stop and disposal.
All four exact requests must physically close before cleanup. The same extracted
Mastra runner also verifies approval, decline, cancellation and a deliberately
lost terminal through the actual local service: eight exact requests, actual tool
results and closure before cleanup. The owner SDK is resolved relative to its
installed package, separately from the service SDK. Scripted service setup and
the loopback fetch guard retain their original ownership and cleanup rules.

To preserve successful artifacts, choose a new directory:

```sh
node scripts/react-parity/verify-ag-ui-candidate.mjs --retain /tmp/threadplane-ag-ui-candidate
node scripts/react-parity/verify-ag-ui-candidate.mjs --review /tmp/threadplane-ag-ui-candidate
```

Review serves the checked candidate bundle without rebuilding, installing or
opening a browser. Run it twice for independent Chrome and in-app browser
sessions. Follow the displayed sequence from First through Try disposed.
`/stats` exposes the existing independent request verdicts and physical closure
evidence. Reload creates a fresh review ID without resetting other pages. Ctrl+C
closes only that command's server and leaves retained files available.

`provenance.json` records source/emission hashes, tarballs, complete installed
Threadplane files and declarations, resolved versions, owner-relative SDK
identity, type/build inputs, browser bytes and browser/provider results. Normal
build hashes and installed artifact hashes describe different stages: npm can
omit build-only metadata such as `.npmignore`. Installed bytes are compared to
the actual unpacked tarball, not to an assumed identical dist directory.

This does not establish hosted model access, universal provider support, durable
cancellation, persistence, history loading, reconnect, client-tool execution, SSR
or hydration. The source review and source Mastra executables remain separate
required proofs; they alone do not prove candidate installation. Final public
selector placement, backend root migration and releases remain separate work.
