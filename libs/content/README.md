# @threadplane/content

Private, unpublished content preparation. `/markdown` owns an incremental document
using the locked `@cacheplane/partial-markdown` 0.5.8 parser. The root stays empty;
`/json`, `/a2ui` and `/testing` remain reserved stubs.

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
