# Installed render-state borrowers

Run `node scripts/react-parity/verify-render-state.mjs --retain NEW_DIRECTORY`
after building core, content, React and Angular. The proof installs those four
actual tarballs into an isolated root-lock-derived mixed presentation. Required
React/content installation dependencies remain in its lock; SDKs, parsers,
protocol packages and backends are excluded from its emitted runtime graph.

The caller controls advance one explicit step at a time: reference and primitive
no-ops, an object write, ordered atomic batch, removing each framework, writing
while absent, remounting, replacing owners twice, writing retired owners,
disposing every owner once, attempting disposed writes, then tearing down views.
Both native bindings borrow the actual owner snapshots; controls own every
command. React runs in development StrictMode; Angular replacement destroys and
recreates its injection context. Disposal clears owner listeners while borrowed
handles remain until explicit view teardown.

The browser proof compares literal expected state and visible DOM, actual object
reference IDs, subscriptions/releases/notifications and command deltas. Retained
evidence includes sources, compiler/runtime inputs, installed bytes and locks,
immutable presentation outputs, requests, screenshots and physical runtime
cleanup observations. `installed-types.ts` and `installed-runtime.mjs` separately
exercise the neutral owner and pinned SDK structural compatibility.
