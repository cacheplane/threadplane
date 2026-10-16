# @threadplane/content

Private, unpublished content preparation. `/markdown` owns an incremental document
using the locked `@cacheplane/partial-markdown` 0.5.8 parser. The root stays empty;
`/testing` remains a reserved stub.

`/json` exports `createJson`, an application-owned incremental JSON document using
the exact `@cacheplane/json-stream` 0.1.1 kernel. It follows the Markdown document
contract: explicit generation, source phase and content; suffix-only updates;
cached immutable snapshots; subscriptions; terminal disposal outside views.

```ts
import { createJson } from '@threadplane/content/json';

const json = createJson({
  generation: 'spec-1', phase: 'streaming', content: '{"title":"Hel',
});
json.update({
  generation: 'spec-1', phase: 'complete', content: '{"title":"Hello"}',
});
const snapshot = json.getSnapshot();
// snapshot.root?.value is owned partial data, not an inferred or validated Spec.
json.dispose();
```

JSON snapshots expose `document`, `root`, `complete` and `error`. Nodes carry
generation-local IDs, kind, status (`incomplete` or `complete`), partial value,
scalar buffers where relevant, and readonly children. Object children are records
and array children are arrays; no parent pointers or vendor objects escape.
Object keys, including empty and `__proto__` keys, are own data properties on
ordinary frozen objects. Duplicate keys retain their last value. Pending literals
and unfinished numbers have undefined values; partial strings expose arrived text.
All nested nodes and values are owned and frozen, with unchanged subtrees and plain
values sharing identity. Projection traverses the current graph on accepted updates;
sharing does not imply constant-time processing.

`complete` means complete JSON syntax without an error, independently of delivery
phase. A complete root can arrive while the source is still streaming; trailing
content can subsequently invalidate it. Syntax diagnostics are accepted snapshots
with code, message and source position, not thrown document-contract errors.
Finalized empty or unfinished input reports `UNEXPECTED_END`; malformed syntax
reports `INVALID_SYNTAX`, and extra root content reports `TRAILING_CONTENT`.
Error states are terminal for suffix updates; a new generation or explicit rebuild
can replace them. The partial root stays available for diagnostics. Callers decide
whether data is suitable for rendering and validate any application schema.

JSON reads, no-ops, listener notifications, exception rollback/replay and disposal
use the ownership semantics described below for Markdown. Disposal does not finish
the parser. The generic React/Angular observer bindings can borrow a JSON owner;
views unsubscribe without disposing it. This remains a private content foundation;
automatic classification, RenderSpec views, SSR and public release are separate.

`/a2ui` exports `createA2uiSurfaces`, an application-owned accumulator for
already parsed, correctly shaped supported A2UI envelopes. Create one owner per
caller-selected message and delivery generation. The caller applies envelopes,
replaces the owner on that lifetime boundary, and disposes the old owner.

```ts
import { createA2uiSurfaces } from '@threadplane/content/a2ui';

// This owner belongs to one chosen message and delivery generation.
const surfaces = createA2uiSurfaces();
surfaces.apply({
  version: 'v0.9',
  createSurface: { surfaceId: 'booking', catalogId: 'application-catalog' },
});
surfaces.apply({
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'booking',
    components: [{ id: 'root', component: 'Text', text: 'Choose a trip' }],
  },
});
const snapshot = surfaces.getSnapshot();
// snapshot.surfaces is immutable raw state; the host chooses how to render it.
surfaces.dispose();
```

Creation and updates stay staged until both creation and a `root` component are
available. Published snapshots preserve surface/component order, own and freeze
nested data, and retain identity until a published command. Accepted input
mutations cannot change retained snapshots. Supported values are finite scalars,
null, undefined, plain records and arrays (including holes). Classes, cycles,
accessors, symbol keys, nonfinite numbers and unsupported array properties throw
before changing staged or published state. Hostile Proxy behavior is outside this
plain-data boundary. Pointer paths use simple slash segments, without RFC6901
unescaping; supported legacy array/deletion behavior is preserved.

Borrow this owner with `useAgent` from `@threadplane/react` or `observeAgent` from
`@threadplane/angular`. Subscriptions only observe: mounting and unmounting do not
apply envelopes or dispose the owner. Each subscription has an independent,
idempotent release. Disposal is terminal, releases staging and listeners, and
retains the last readable snapshot; later `apply` calls throw.

This is a private accumulator foundation. It does not parse or classify text,
infer message identity, deduplicate deliveries, expose renderer readiness, or
provide catalog views, forms, validation, actions or publishing. Full legacy
renderer parity and SSR remain separate work.

`/render-state` exports the runtime factory `createRenderState` and four readonly
types: `RenderState`, `RenderStateValue`, `RenderStateSnapshot` and
`RenderStateChange`. This optional private entry owns application state; its
runtime graph has no framework, backend SDK, parser or protocol dependency.
The package root and its existing dependencies are unchanged.

```ts
import { createRenderState } from '@threadplane/content/render-state';

// Create outside rendering, at the application's chosen lifetime boundary.
const state = createRenderState({ trip: { destination: 'Paris' }, selected: false });
const release = state.subscribe(() => console.log(state.getSnapshot()));
state.set('/selected', true);
state.update({ '/trip/destination': 'Lisbon', '/trip/days': 3 });
// Views borrow state through useAgent(state) or observeAgent(state).
release();
state.dispose(); // The application disposes it when that lifetime ends.
```

The initial state and root replacements must be ordinary or null-prototype
records; the default is `{}`. Nested values can be finite numbers, strings,
booleans, null, undefined, plain records and standard arrays. Capture copies own
enumerable string data into recursively frozen null-prototype records and frozen
arrays. Sparse slots and array-growth gaps become own undefined entries.
Non-enumerable record data is ignored. Accessors are rejected without evaluation,
as are symbol keys, cycles, classes, functions, nonfinite numbers and nonstandard
array properties/prototypes. Repeated noncyclic aliases are accepted and captured
independently. Caller mutations cannot alter current or retained snapshots.
Hostile Proxy behavior is outside this plain-data boundary.

`getSnapshot()` returns the owned record directly. `get(path)` reads only own
properties. Both `''` and `'/'` address the root; other paths must start with `/`.
Segments decode `~0` to `~` and `~1` to `/`; malformed escapes throw. The root
slash alias excludes addressing an empty root member. Missing valid paths read
undefined. Existing arrays accept only canonical nonnegative indices below
2^32 - 1; negative/noncanonical indices, `length` and other array properties
throw, while reads beyond the current length return undefined. Record keys,
including numeric and prototype-named keys, remain own data. Deep writes through
missing or scalar branches create records, including numeric branches; they do
not infer arrays. Existing arrays retain their array behavior.

Writes validate input before considering a no-op. The original incoming value
is compared with the current owned value using strict equality. Equal primitives,
an exact existing snapshot branch, or undefined at an absent path preserve the
snapshot and `lastChange()` identity and send no notification. A new equivalent
object is an accepted write. Reusing a mutated caller object remains a write
because accepted values were captured separately. Unchanged owned branches retain
identity; there is no schema inference or validation of application fields.

`update(updates)` validates the entire plain updates record, paths and values
before accepting anything. Own enumerable paths run in observed enumeration order
against a private working state, including overlapping paths and root aliases.
Array traversal is checked against that ordered working state. Any later error
discards the whole batch. An accepted batch commits once and publishes one
invalidation; `lastChange()` records the final applied original path and its owned
written value. Empty/all-no-op batches preserve metadata. A batch that applies
writes and returns to equivalent data still publishes.

Subscriptions have independent idempotent releases, including duplicate callbacks,
and do not notify initially. Snapshot and change metadata commit before callbacks.
Observer errors are contained; reentrant writes execute synchronously and queue
invalidation passes without recursive callback delivery. Later observers can read
a newer accepted snapshot. Removed observers are skipped and disposal clears
pending delivery. `dispose()` is terminal and idempotent: it releases listeners,
retains readable snapshot/get/change results, makes new subscriptions inert and
makes later `set`/`update` commands throw. Mounting, StrictMode replay, unmounting,
subscription release and owner replacement issue no commands or disposal.

This is a bounded T20 state foundation. Readiness, form sessions, validation,
actions, catalog rendering, SSR and public release remain open. The installed
SDK StateStore assignment proves structural compatibility only; these documented
path/data boundaries do not establish complete SDK, legacy or RFC parity.

`/messages` exports `createMessageContent`, which projects immutable agent
snapshots into cached transcript rows. Each row owns answer `markdown` and, when
the backend supplies a nonempty `Message.reasoning`, a separate optional
`reasoning` Markdown snapshot. Reasoning uses `${delivery.generation}:reasoning`
and the same delivery phase. Empty and omitted reasoning release its owner;
whitespace stays intact. All roles preserve explicit reasoning; views decide
which roles to display. No answer text or timing is inferred as reasoning.

Unchanged documents and rows retain identity. Reasoning-only updates preserve
the answer snapshot and unrelated rows. Removed messages release both owners;
disposing the projection releases all owners once and makes later projections
inert. Previously returned rows remain readable. Keep this owner outside views
and dispose it at the application transcript lifetime boundary.

```ts
import { createMarkdown } from '@threadplane/content/markdown';

const markdown = createMarkdown({
  generation: 'answer-1',
  phase: 'streaming',
  content: '# Hello',
});
const release = markdown.subscribe(() => console.log(markdown.getSnapshot()));
markdown.update({
  generation: 'answer-1',
  phase: 'complete',
  content: '# Hello world',
});
release();
markdown.dispose();
```

Construction parses synchronously. Reads and subscriptions return the cached frozen
snapshot without parsing or projection. Same-generation updates append only a
suffix, and completion finishes once. A new generation replaces the parser.
Identical input preserves the snapshot and does no work. Same-generation shrink,
divergence, completed-content changes or reopening throw before parser mutation.
Choose `{ violationPolicy: 'rebuild' }` explicitly to replace on those violations.

Published nodes, children, tasks and definitions are owned and immutable; parent
links are null. Definition collections support lookup, iteration and `forEach`
without exposing mutators or the backing map. Unchanged subtrees share identity.
Projection inspects the canonical graph on accepted updates; sharing does not
imply constant-time append processing. Empty content has a null root even after
completion.

Each primitive document field is captured once. Getter-triggered commands remain
real commands; the outer update classifies against the latest accepted snapshot.
Updates commit before notifying. Notifications are invalidations: reentrant updates
execute synchronously and their notifications coalesce after the current pass.
Later listeners may see a newer snapshot. Registrations are independent, removed
listeners are skipped, newly added listeners join subsequent passes, and listener
errors are contained.

An unexpected parser or projection failure leaves the accepted snapshot unchanged
and discards derived state. The next accepted update reconstructs from that
snapshot; reads and no-ops remain inert. Disposal drops parser/cache/subscriptions,
retains the last snapshot, does not finish, and is terminal. Later subscriptions
are inert and updates throw. The unchanged generic React/Angular bindings can
borrow this observer shape; releasing a view does not dispose the owner.

Native views accept the whole `MarkdownSnapshot` through the private
`@threadplane/react/markdown` and `@threadplane/angular/markdown` entries. The app
owns this object and observes it with `useAgent` or `observeAgent`; the views do
not parse, update, subscribe to or dispose it. Keep an owner outside rendering and
release it when its document lifetime ends, independently of a view's lifetime.

The feature also exports the pure `markdownUrl(value, 'link' | 'image')` helper.
It returns an accepted destination unchanged, or `undefined`. HTTP/HTTPS and
relative destinations are supported; links also support `mailto:` and `tel:`.
Empty/malformed values, ASCII control characters, ambiguous raw prefixes and
other schemes are rejected, including data images. Classification uses a fixed
HTTPS base, not the page location; that base never appears in the returned value.
Ordinary relative values such as `./a&b` retain their spelling. The views render
blocked links as their text and missing, blocked or failed images as an accessible
alt-text fallback. HTML nodes render literally, not as inserted markup.

The native views include semantic headings, lists, tasks and tables. Math stays
delimited text and citations use numbered or unresolved text markers; there is no
math engine, syntax highlighter, citation overlay or node registry. This remains
a private feature, not a completed legacy extraction. Existing public Angular
Markdown components and their lifecycle remain unchanged. SSR serialization,
hydration and full legacy renderer parity are separate work.

Build with `npx nx build content`. Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.
