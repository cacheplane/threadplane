# @threadplane/content

Private, unpublished content preparation. `/markdown` owns an incremental document
using the locked `@cacheplane/partial-markdown` 0.5.8 parser. The root stays empty;
`/a2ui` and `/testing` remain reserved stubs.

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
