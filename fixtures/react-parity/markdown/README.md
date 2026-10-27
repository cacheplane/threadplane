# Installed owned Markdown observation and native presentation

The original `/` fixture borrows one real installed `@threadplane/content/markdown` owner
through the unchanged React `useAgent` and Angular `observeAgent` bindings. It
displays literal input, owned node summaries and reference evidence. It is not a
Markdown renderer, HTML sanitizer, backend demo or completed legacy extraction.

The distinct `/presentation` page renders one application-owned snapshot with
installed `@threadplane/react/markdown` and the real Angular APF
`@threadplane/angular/markdown`. A normal decorated host is compiled by the locked
Angular application builder with strict templates. Both native views borrow the
same owner through the unchanged bindings. They never create, update or dispose
content themselves.

Build the local artifacts, then run the required Chromium proof:

```sh
NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p content,core,react,angular --skip-nx-cache --outputStyle=stream
node scripts/react-parity/verify-markdown.mjs
```

To preserve a successful proof for manual review, choose a directory that does not
exist. Failed runs remove only their owned temporary directory.

```sh
node scripts/react-parity/verify-markdown.mjs --retain /tmp/markdown-ownership-final
node scripts/react-parity/verify-markdown.mjs --review /tmp/markdown-ownership-final
```

Review checks the retained HTML/CSS shell, bundle, tarballs, installed package bytes, copied
fixture, type probes, compiler configs and consumer lock before serving the frozen
bundle on an ephemeral loopback port. Reachable vendor runtime and declaration
inputs are hashed and checked too. It does not rebuild or open a browser. Open
the printed URL and follow the enabled controls:

1. Append
2. Remove React
3. Append more
4. Mount React
5. Remove Angular
6. Complete
7. Mount Angular
8. New generation
9. Dispose
10. Try disposed

React and Angular share the exact cached snapshot. Removing a view releases its
subscription without updating or disposing the owner. Remounting creates new DOM
and observes the current snapshot. Completion updates the image node status;
retained snapshots remain unchanged. Disposal preserves the last snapshot and
rejects the last attempted update. Reload starts an independent owner. Each review
process owns only its own server; stop it with Ctrl-C or SIGTERM.

Fixture-only observer delegates count registrations, cleanup calls and delivered
notifications around the actual owner's `subscribe`. Both delegates return the
same underlying snapshot; commands still go directly to the owner. The proof
checks one outstanding cleanup handle per mounted view despite React StrictMode churn,
zero after removal, and no later notifications to a removed view. These counters
observe binding cleanup, not parser work or private owner internals. After owner
disposal, mounted delegates remain unreleased until view teardown, but receive no
further notifications. `outstanding` counts these binding handles, not the owner's
internal listeners: disposal has already cleared those listeners.

For native presentation, open the printed `presentationUrl` and follow its enabled
controls in order:

1. Append
2. Append task and table
3. Append document
4. Equal render
5. Arrive definitions
6. Finish
7. Replace failed image
8. Late old image error
9. Fail current image
10. New generation
11. Remove React
12. Append without React
13. Mount React
14. Remove Angular
15. Append without Angular
16. Mount Angular
17. Dispose
18. Try disposed

The first paragraph tests multiple spaces, soft breaks and long-token wrapping.
Earlier paragraphs, lists and tables keep DOM identity through append, equal
render and finish. Definitions resolve references; tasks and a second table arrive
in fragments. HTML remains escaped text, both math delimiter forms remain raw, and
citations use accessible markers. Unsafe URLs become readable fallbacks. The
fixture explicitly chooses `violationPolicy: 'rebuild'` for its same-generation
image URL replacement; the production default remains `throw`.

Owned image routes return a real SVG and deliberately invalid PNG bytes with
HTTP 200. The latter causes native decoding failure without masking HTTP or
console errors. The later control dispatches a delayed error on the retained,
detached old image; it must not affect its replacement. The new generation resets
local failure state. View removal/remount leaves owner snapshot identity unchanged;
only the intervening application controls update it. Disposal rejects the final
update and delivers no notification.

`provenance.json` records the scoped source hashes, root and installed lock hashes,
all four actual tarballs, installed package bytes, strict NodeNext/Bundler compiler
inputs, browser compiler/bundle inputs, locked owner-relative vendor graph and
browser outcome. Installed bytes are compared with unpacked tarballs. No source
aliases, declaration substitutes or `skipLibCheck` are used. Workspace dependency
installation is not asserted; isolated consumer versions must match the root lock.

Native presentation also records all Angular-generated output hashes, builder and
strict compiler configurations, runtime/type inputs and explicit missing/wrong
snapshot template diagnostics. `/presentation` serves retained generated HTML;
`/presentation-assets/` serves only the complete checked output/image allowlist.
Review rejects missing, changed, unrecorded or escaping presentation files and
does not rebuild them. The original `/` and `/app.js` routes remain available.

The browser proof checks all ten controls, literal text, mounted DOM stability,
new DOM on remount, both observers, retained snapshots, disposal and clean console
and network behavior. Private unit counters separately prove that observation and
no-ops do not parse or project; those counters are not a public browser API. Node
imports and lifecycle checks make zero fetch calls. These checks do not establish
SSR, hydration, durable serialization or parser behavior for every possible input.
The additional native proof compares browser-visible text, semantic elements,
accessible labels, href/alt attributes, valid table/list DOM and computed paragraph
spacing/line layout, with clean console and no external requests. Its real parser
fixtures cover 26 of 27 node kinds. `hard-break` is supplementary unit coverage
only; the browser proof does not synthesize parser nodes or claim it observed that
kind. This remains native baseline presentation, without rich math/citation
renderers, registries or completed legacy extraction.
