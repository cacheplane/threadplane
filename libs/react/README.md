# @threadplane/react

`@threadplane/react/chat` includes passive `ChatMessage` composition: a required
readonly core role, optional previous-row role and literal speaker/label, independently directed body,
passive before/after content slots, current/streaming flags, and consumer-owned controls. All eleven props
are readonly. Rich chrome outside the body keeps its surrounding direction.
The default MessageList and native custom renderer
use it without changing content ownership or scrolling. See the
[ChatMessage guide](../../apps/website/content/docs/react/chat/components/chat-message.mdx).
Both flags default to false. A current streaming assistant shows one decorative
caret inside its body. `MessageList` supplies `current` only for the final supplied
row and derives `streaming` from message delivery. A stable
`renderMessage(row, context)` receives readonly `MessageListRowContext.current` and
optional `prevRole`, derived from the immediately preceding supplied projected row;
one-argument renderers remain supported. `Chat` forwards the same callback contract.
Custom renderers forward `prevRole`, `current` and delivery-derived `streaming` to
`ChatMessage`. The first row has undefined `prevRole`, which omits `data-prev-role`.
Explicit assistant-to-user context gives 1.5rem block-start spacing through wrappers;
omitted context keeps the adjacent-sibling fallback. Explicit other roles override
that fallback. Existing assistant `:first-child` spacing remains DOM-dependent.
The ten current/previous-role context combinations share stable frozen objects;
changing a predecessor's projected role updates the following row even when its
immutable row reference is retained. With the opt-in chat stylesheet, a historical
assistant's direct controls wrapper reserves its space but stays transparent and
ignores pointer input until its article is hovered or contains keyboard focus.
Current assistant controls stay visible. At widths up to 768px or on devices with
no hover support, assistant controls stay visible. Controls remain in the DOM and
tab order; opacity transitions take 200ms and are disabled with reduced motion.
Without the stylesheet, controls use normal DOM presentation. The wrapper does
not suppress controls during streaming. Non-assistant controls, standalone
`MessageActions` and nested rich-content controls keep their existing behavior.
Handlers, clipboard writes, status and disabled states remain application-owned.
Full T23 parity remains open.

Private, unpublished React binding for app-owned sessions. The root exports
`useAgent(session)`, which accepts `getSnapshot()` and `subscribe(notify)` methods
and returns their concrete `TSnapshot` through React's `useSyncExternalStore`.
The observer contract is structural:

```ts
{
  getSnapshot(): TSnapshot;
  subscribe(notify: () => void): () => void;
}
```

`TSnapshot` is unconstrained. The hook preserves its exact authored type,
including readonly fields and, for core-compatible sessions, typed tool names,
arguments and results. It does not require a core display projection.

```tsx
import { useAgent } from '@threadplane/react';
import type { AgentSession } from '@threadplane/core';

export function Status({ session }: { session: AgentSession }) {
  const snapshot = useAgent(session);
  return <p>{snapshot.status}</p>;
}
```

The hook borrows the session. Rendering, subscribing, StrictMode remounts, and
unmounting do not start runs. Unmounting releases that observer's subscription;
it does not stop pending work or dispose the session. Multiple components can
observe the same session. The app calls `session.submit(text)`, `session.stop()`,
and `session.dispose()` and owns the session's lifetime. Replacing the session
prop transfers the subscription without disposing the previous session.
Snapshot reads and subscription calls preserve the session method receiver.

The owner must return a stable snapshot between changes, publish a changed
aggregate reference when data changes, and notify its subscribers. React compares
snapshots with `Object.is`. Subscribing must register notifications without
issuing commands and return an idempotent release function. The owner is
responsible for immutable snapshots; the hook neither freezes mutable data nor
adds deep readonly types to caller-authored mutable fields.

Keep the concrete session type when observing backend-specific fields. The private
LangGraph fixture exposes a broad readonly `values` map on its snapshot: `undefined`
means no current application-values map is observed, while `{}` is an observed
empty map. The hook preserves that field without inferring an application schema,
validating values, or issuing extra reads. Values and messages arrive in the same
immutable snapshot. This does not make the private backend factory public or add
state-writing support.

The private AG-UI session is also observed directly: its native snapshot contains
`transcript`, `state`, `subagents` and root `run` evidence. Partial tool arguments
remain raw protocol strings; observing them does not authorize tool execution or
invent core pending-tool states. Integration tests borrow the actual private
owner through a browser-safe Fetch API fixture. This is not a public AG-UI factory
or a claim that shared display components accept every native snapshot.

The root retains `use client`. Server rendering and hydration are not supported
by this binding. No backend constructor is exported here; the current real
LangGraph runtime is still a private development composition seam. This API is
under development and is not a published compatibility or feature-parity claim.

Build with `npx nx build react`; run `npx nx test react` and
`npx nx run react:type-tests` for real-session and strict type coverage. React
19.2.4 is the tested runtime. React DOM ^19.2.4 is a required peer for chat
portals; the headless root does not import React DOM.

`@threadplane/react/chat` is a separate client entry for a plain-text conversation:

```tsx
import { TextTranscript } from '@threadplane/react/chat';

const rows = [
  { id: 'question', role: 'user', content: 'Hello\nworld' },
] as const;
<TextTranscript messages={rows} label="Conversation" />;
```

Rows are readonly structural `id`, core `role`, and string `content` values; extra
fields are allowed. IDs must be unique within the list. The component renders all
supplied rows literally, including empty text and intentionally supplied system or
tool rows. Caller composition selects visible messages without rewriting history.
It preserves whitespace and keyed mounted rows, using a named section and ordered
list. It does not announce tokens, move focus, scroll, issue commands or own a
session. Unmount/remount creates new DOM while ownership stays with the app.

The same `/chat` entry exports `ToolObservation` and readonly
`ToolObservationProps` for explicitly supplied tool text:

```tsx
import { ToolObservation } from '@threadplane/react/chat';

<ToolObservation
  name="weather"
  argumentsText={'{"city":'}
  label="Worker weather"
/>;
```

`name` and `argumentsText` are required strings. Optional `resultText` is omitted
when absent; an empty string still renders a Result field. The default label is
`Tool observation`. All text renders literally with whitespace and long-line
wrapping, including partial JSON and strings such as `null` or `undefined`.
The caller selects the call, associates its result and formats known values.
The component does not parse arguments, infer execution status, subscribe or
execute tools. Updating text preserves its mounted section and arguments DOM;
remounting creates new DOM.

The root remains headless. `TextTranscript` and `ToolObservation` do not provide Markdown, execution
controls, citations, reasoning, rich chat parity, SSR or hydration support. The private
AG-UI review uses an O(N) pure root-text selection; previous-output row reuse is an
optional bounded current-row optimization. React composition memoizes by the actual
owner and immutable transcript reference without advancing a mutable render cache.

`Reasoning` borrows a required owned `MarkdownSnapshot`, typically
`row.reasoning` from `@threadplane/content/messages`. It renders the existing
Markdown view inside an accessible disclosure. Streaming defaults open with
“Thinking…”; completed content defaults collapsed with “Show reasoning”. Empty
documents hide the disclosure. Optional `label`, `defaultExpanded`, `className`
and app-supplied `durationMs` customize presentation; no timing is inferred.

Manual expansion choices persist through updates and completion within a
generation. A new generation or completed document reopening resets the choice.
The view never parses, subscribes, runs commands or disposes its snapshot. Default
`MessageList` shows reasoning before assistant answers; custom renderers select
their own presentation. Styles remain opt-in through `/chat/styles.css`.

`@threadplane/react/markdown` exports the client component `Markdown` and readonly
`MarkdownProps`. It accepts a required, whole `MarkdownSnapshot` from an app-owned
content object:

```tsx
import { useAgent } from '@threadplane/react';
import { Markdown } from '@threadplane/react/markdown';
import type { Markdown as MarkdownOwner } from '@threadplane/content/markdown';

export function Answer({ owner }: { owner: MarkdownOwner }) {
  const snapshot = useAgent(owner);
  return <Markdown snapshot={snapshot} />;
}
```

Create and update the owner in application composition, outside React rendering.
The component only presents the supplied snapshot; it has no parsing, subscription
or owner lifecycle. Use `useAgent` when observation is needed, or pass a snapshot
directly. Unmounting the view does not dispose the owner. A document generation
change resets local image state; replacing an image destination allows recovery
after a failed load.

The renderer preserves literal HTML as text, uses semantic lists/tables and
disabled task checkboxes, and resolves references from the snapshot. Math remains
delimited text. Optional readonly `citations` supplies per-message `Citation[]`:
exact IDs override Markdown definitions, including sources with blocked or absent
URLs. Duplicate supplied IDs throw `TypeError`. Otherwise definitions provide the
index, literal title before their first immediate link/autolink, and destination.
Safe targets become labelled external links; blocked or absent targets remain
readable numbered markers, and unresolved IDs retain `[^id]`. Inside an existing
anchor a citation stays a noninteractive marker. Replacing/removing metadata takes
effect on the next render, with no metadata fetching or owner lifecycle. Missing,
blocked and failed images show an accessible alt-text fallback. Destination
classification is the fixed [`content/markdown` policy](../content/README.md),
including exclusion of data images. The root binding stays headless; rich math,
syntax highlighting, custom node registries, legacy migration,
SSR and hydration remain outside this private feature.

Set readonly `citationPreview` to `true` to replace resolved inline markers outside
anchors with source buttons: `<Markdown snapshot={snapshot} citations={sources}
citationPreview />`. Focus or activation opens a connected, nonmodal details card;
fine-pointer hover opens after 120ms and leaving closes after 200ms. The card
stays open while its trigger or controls own focus. Tab enters the card, Shift+Tab
returns to the trigger, and Tab from the last control continues through the page.
Escape, Close, outside pointer interaction, or focus departure dismisses it.
Only the explicit safe “Open source” link navigates. Titles, snippets and dates
remain literal borrowed metadata; icons and metadata are never fetched. The card
adds a local source marker and a summary of normalized source type, hostname and
formatted publication date above those literal details. The decorative marker
adds no keyboard focus target. Same-ID corrections update the open summary in place.
The card uses the trigger's document, follows viewport/scroll changes and needs no chat
stylesheet. Generation, marker identity, removal and unmount retire its local state.
Omitting the opt-in preserves direct links and numbered markers.

## Chat

`Citations` presents an explicit readonly `Citation[]` from `@threadplane/core`
as a named Sources section. Empty input renders nothing. It preserves supplied
order, index, title and snippet; IDs must be unique. Default rows use `CitationCard`
for local source icons or monograms, normalized source-type badges, a derived
hostname, and an optional formatted publication date. Optional
`label` and `className` customize the section. Same-ID updates preserve mounted
source items. An absent title falls back to the supplied URL or `Source <index>`;
intentionally empty fields remain empty.

Set `collapsible` to `true` for a Sources disclosure that starts closed. Its
header shows the label and current source count, a decorative preview of at most
the first three sources in the resolved displayed order, and a chevron reflecting
`aria-expanded`, with a stable controlled body. The preview uses local category
icons or web monograms, ignores provider images and performs no fetch. Decorative
visuals do not change the accessible label and count; static headings are unchanged. Enter, Space, click, or tap toggles it. Collapsed source controls
are unmounted; reopening starts fresh source previews. Updates preserve the
expansion choice and keyed source rows while open. The choice belongs to the
mounted message; removing it or switching between static and collapsible modes
retires that presentation. This adds no fetching or conversation commands.

```tsx
import { Citations } from '@threadplane/react/chat';

<Citations citations={message.citations ?? []} />;
```

Pass the same accepted Markdown `snapshot` used by the message's `Markdown`
view to include its sidecar definitions:

```tsx
<Citations citations={message.citations ?? []} snapshot={snapshot} collapsible preview />;
```

With `snapshot`, Sources combines provider citations and previously unseen
Markdown definition IDs, then orders the combined list by ascending index.
Equal indices retain provider order followed by definition order. An exact
provider ID wins as a whole record, including absent fields; sidecars never
fill missing provider metadata or replace a blocked provider URL. IDs are
case-sensitive. Neither input is mutated. Without `snapshot`, supplied order
stays unchanged. The caller keeps the snapshot scoped to its message and owns
parsing and lifetime. Same-ID streaming corrections retain mounted source rows
and refresh open previews; removing a source retires its preview.

Allowed URLs use the existing content/Markdown link policy, with a native new-tab
link and `noopener noreferrer`. Missing or blocked URLs display text. The view
does not fetch icons, previews or metadata, parse snippets,
subscribe or dispose anything. Markdown definition text before
its first top-level link becomes the title, and text after it becomes the snippet,
shared with inline citation previews. Default `MessageList` assistant rows pass
their provider metadata to inline Markdown references and merge Sources with the
same accepted Markdown snapshot. Whole provider records win exact-ID collisions;
combined sources use stable ascending index order, including Markdown-only sources.
Metadata-only corrections update both presentations without reparsing unchanged
Markdown. User and system rows receive no provider metadata, and tool text remains
literal. Custom row rendering selects its own presentation. Styles are opt-in
through `/chat/styles.css`.

`CitationCard` also accepts a required readonly core `citation` and optional
`className` for custom compositions. Its source marker is decorative: known
non-web categories use local SVG icons; web sources use a deterministic monogram.
Provider `iconUrl` values are ignored in favor of that local fallback, so rendering
never requests an icon or source URL. Custom source-type labels and snippets stay
text. Snippets display one line with ellipsis while retaining their complete text
in the DOM and explicit preview. Local SVG source markers and title links follow
the card foreground by default, including scoped themes. Missing and invalid dates
are omitted; valid dates use the host locale and
timezone. Hostname derivation does not approve navigation: blocked URLs can still
have a displayed hostname, with no title link.

```tsx
import { CitationCard, CitationPreview } from '@threadplane/react/chat';

<div>
  <CitationCard citation={citation} />
  <CitationPreview citation={citation} />
</div>;
```

Set `preview` on `Citations` to replace source titles with explicit source-details
buttons. The separate `CitationPreview` component accepts a required readonly
core `citation` and optional `className` for the same trigger and modal:

```tsx
<Citations citations={message.citations ?? []} preview />;
```

Click, tap, or activate the trigger with a keyboard to inspect the supplied title,
snippet, source type, publication text, and URL. Text stays literal; metadata and
icons are never fetched. Allowed URLs get a separate **Open source** new-tab link
using the shared URL policy. Missing or blocked URLs remain readable text.
Above the literal details, a local decorative marker and source summary show the
normalized type, hostname and formatted publication date using the same helpers as
`CitationCard`. Missing or invalid display dates are omitted from the summary while
the original publication text remains in the details. Hostname display does not
approve a link. Provider images are never loaded.
The modal focuses **Close**, contains Tab navigation including the optional link,
and dismisses with Close, Escape, or a click outside its bounds. It restores
focus to the available trigger when it still owns focus. Same-ID metadata updates
refresh the open preview; changing the citation ID or removing its view retires
it. Preview state belongs to the mounted view and never issues session commands.
The default Sources list retains direct links. `Markdown.citationPreview` provides
the separate inline hover/keyboard/touch cards described above.

Use `renderCard` to customize the contents of each source list item:

```tsx
<Citations
  citations={message.citations ?? []}
  renderCard={(citation) => <CitationPreview citation={citation} />}
/>;
```

The callback receives only the latest borrowed readonly `Citation`. It takes
precedence over `preview`, including when it returns `null`, `false`, or
`undefined`; there is no fallback for an empty result. Empty lists and closed
disclosures do not render cards. Treat the callback as rendering code: React may
call it repeatedly. Put hooks in a component returned by the callback.

The library keeps each list item keyed by the exact citation ID. Compatible
returned components retain state through reordering, same-ID metadata updates,
and replacement callbacks. Collapsing the list or removing a source unmounts its
card. The application owns custom markup, links, and actions; compose
`CitationPreview` to reuse its safe links and modal behavior. Shared display
helpers from `@threadplane/content/messages`, such as `deriveDomain` and
`formatPublished`, let custom cards opt into host and date presentation. Hostname
extraction does not approve a link for navigation, and date formatting uses the
host locale and timezone. Compose `CitationCard` to reuse the default local visuals
without changing the literal metadata shown by `CitationPreview`.

`MessageActions` renders a named group of explicitly authored native buttons.
`MessageAction` has exactly six readonly fields: required unique `id`, literal
string `label` and argumentless `onSelect`, plus optional `disabled`, `icon` and
`iconOnly`. `MessageActionsProps` retains four readonly fields: required `actions`
and optional `disabled`, `label` and `className`. Group and action disabled states
default to false; either disables the native button. The default group label is
`Message actions`; empty actions render nothing.

`icon` accepts app-authored decorative, noninteractive ReactNode content.
`iconOnly` defaults to false; only `true` with a supplied icon enables compact
presentation. Exactly `null`, `undefined` and booleans omit the icon and fall back
to the visible label, even with `iconOnly: true`. Zero, strings (including empty
strings), arrays (including empty arrays), fragments and components that render
nothing follow normal ReactNode semantics. The library does not inspect children;
compact callers must supply a visible, noninteractive glyph.

Icons render inside an `aria-hidden` wrapper. The literal string label always
provides the button's accessible name. With the opt-in chat stylesheet, compact
actions visually hide that label, use at least 36px square targets and size direct
SVG glyphs to 16px. The compact button's native `title` is the same literal label,
independently of CSS. Without the stylesheet, both icon and label remain visible
in normal DOM presentation. Text-only and icon-plus-label actions keep visible labels.

The app owns clipboard writes, pending state, async feedback and errors; it must
handle promise completion and rejection itself. No regeneration command is
supplied; ratings use the separate controlled `MessageRating` below. Rendering,
updating and unmounting invoke no action.
Compatible same-ID updates and reordering retain each native button and its focus
where native disabled behavior permits; activation calls the current argumentless
callback. This private feature does not complete T28 or establish public release parity.

```tsx
import { MessageActions } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

export function CopyAction({ onCopy, disabled = false }: {
  readonly onCopy: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <MessageActions
      actions={[{
        id: 'copy',
        label: 'Copy answer',
        onSelect: onCopy,
        iconOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
            stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        ),
      }]}
      disabled={disabled}
    />
  );
}
```

`ApprovalCard` is an inline, named region with an app-authored body and explicit
actions. Each action has a unique `id`, `label`, `onSelect` callback and optional
`disabled` flag. The card's `disabled` flag disables all actions. Clicking does
not hide or consume the card; the app owns interrupt matching, decision tokens,
pending/error state and command handling. Async callbacks must handle their own
rejections. The card adds no modal, focus management, timer or session lifecycle.

```tsx
import { ApprovalCard } from '@threadplane/react/chat';

<ApprovalCard
  disabled={!canRespond}
  actions={[{ id: 'approve', label: 'Approve', onSelect: respond }]}
>
  <p>{reason}</p>
</ApprovalCard>;
```

```tsx
import { Chat } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

<Chat session={session} />;
```

`Chat` observes an app-owned `AgentSession`, streams assistant Markdown, shows tool
calls and the session error, and sends with Enter (Shift+Enter adds a line). It
submits the trimmed draft and ignores rejected `submit`/`stop` promises; the session
reports failures through its snapshot. A failed send does not restore the draft.
Switching sessions resets the draft. Chat never disposes the session.

`ScrollBubble` is a passive latest-activity button with required readonly
`mode: 'streaming' | 'idle'` and `onClick: () => void`. `MessageList` optionally
renders `renderScrollControl` as a sibling of its unchanged region. Its readonly
`pinned`, `scrollToLatest()` and `focus()` controls keep scrolling with the
existing owner. Attach both methods to an explicit click handler to restore
following and focus the region with `preventScroll: true` before hiding the
button. Retained controls are inert before commit and after unmount. Default
`Chat` uses its existing snapshot status; no new subscription is created.
The visible action stays readable without CSS and has no live-region semantics.
This bounded T23 slice does not add unread counts or history loading.

`Trace` from `@threadplane/react/chat` is a disclosure for one step of work. Pass
a `label`, an optional decorative `icon`, optional `meta` such as a duration,
and the detail as children. `state` is `pending` (default), `running`, `done` or
`error`: a running or failed trace is open, and any other follows
`defaultExpanded`. A press toggles it, and that choice holds until the trace
next enters `running` or `error`, when it opens again. Collapsed detail stays
mounted and hidden. The root carries `data-state` and `data-expanded` for
styling; `Trace` owns only the reader's choice.

`TypingIndicator` and `isTyping` from `@threadplane/react/chat` provide controlled
waiting-before-text presentation from a borrowed core snapshot. `active` is
required; optional readonly `label`, `announce`, and `className` customize the
literal label, polite atomic status announcement, and styling. Inactive renders
nothing. `isTyping` requires running status and no messages, a last user message,
or empty last assistant string content. Any assistant text (including whitespace),
or a last tool/system message hides it. Default `Chat` composes it from the existing
snapshot after `MessageList`. Set `announce={false}` when the application already
announces submission progress. Dots are decorative CSS animation with reduced
motion support; the label remains readable without CSS. No execution, session
ownership, commands, subscriptions, or timers are added. This bounded text-only
slice does not complete T23 or legacy typing/runtime parity.

`ChatError` from `@threadplane/react/chat` displays a required nullable readonly
`AgentError` as one literal accessible alert with optional detail. Explicit
`onRetry` and `onCheckStatus` callbacks receive zero arguments and own their async
results. Check recovery requires its callback and never falls through to retry;
explicit `none` suppresses every action. Retry requires retryable metadata and
its explicit callback. `disabled` retains the action without activation.
Default `Chat` forwards supported session `checkStatus`, checks the latest error
identity before recovery, and accepts an optional app-owned `onRetry` intent.
It never replays submit. The native example supplies no execution recovery
callbacks; selection Retry remains a separate selection reload.

Without a `content` prop, Chat owns one message projection per session and releases
it on unmount or session change. To keep the projection across remounts, create it
once with `createMessageContent()` from `@threadplane/content/messages` and pass it
as `content`:

```tsx
// Module scope (or wherever the app keeps its session), not inside render.
const content = createMessageContent();

<Chat session={session} content={content} />;
```

The app owns that projection and calls `content.dispose()` when it is done with it;
Chat never disposes app-passed content. The stylesheet is opt-in and scoped to chat
and Markdown classes, with `--tp-chat-*` custom properties that fall back to `--ds-*` tokens.
Compose `MessageList` and `ChatInput` directly when your app owns selection or
rendering.

The shared presentation uses a bounded reading column, user bubbles, a pill
composer, scrollable tables and native task-checkbox semantics. Override
`--tp-chat-bg`, `--tp-chat-surface-alt`, `--tp-chat-reading-width`,
`--tp-chat-font-family`, `--tp-chat-font-size-base`, or the
`--tp-chat-radius-*` properties on the composed part to customize it. An explicit
`color-scheme` or `--tp-chat-color-scheme` selects the host's light/dark treatment.
User bubbles use the neutral inverted palette; override `--tp-chat-user-bg` and
`--tp-chat-user-text` on the composed part to supply a different color pair.
Custom message renderers retain their own layout and need their own integration.

The composer and authored Markdown use automatic text direction; fenced code
blocks retain left-to-right source order. When a focused Stop button disappears
after stopping or completing a response, focus returns to its composer. Completion
does not move focus from another control. The named transcript is keyboard
focusable so readers can scroll without activating a message action.
After an accepted clearing submit, the composer returns focus from its Send button
on the next frame while it still owns focus. Focus moved elsewhere by the user or
an application callback is preserved, and a replaced composer is never focused.
The composer also recalculates draft height when its container or viewport
resizes, retaining the draft and the existing viewport height cap.

`ChatInput` accepts three app-owned slots: `leading` sits before the draft inside
the input surface, `trailing` sits between the draft and the built-in Stop and
Send, and `footer` follows the hint. `Chat` passes the same content through
`inputLeading`, `inputTrailing` and `inputFooter`. An absent, `null` or `false`
slot adds no element.

```tsx
<ChatInput
  onSubmit={accept}
  trailing={
    <button type="button" onClick={openTools}>
      Tools
    </button>
  }
  footer={<p role="status">{status}</p>}
/>
```

Two more slots sit above the input surface: `banner` for a notice such as a
paused or read-only state, then `attachments` for content that belongs to the
next message, such as chosen files (`Chat`: `inputBanner`, `inputAttachments`).
The composer never reads, sends or clears either one. Your `onSubmit` sends the
files you hold and clears them, and a banner that should be announced carries
its own `role="status"`. A model picker needs no slot of its own: pass a
`Select` as `trailing`.

Slot content sits inside the composer form and is otherwise untouched: it keeps
its own state across drafts and submissions, stays enabled while the composer is
`disabled` or `busy`, and supplies its own names and focus styles. Give slot
buttons `type="button"`; a slot submit button, or Enter in a slot text field,
sends the draft like Send but never receives the composer's focus return. Keep
slot controls compact, because the draft takes only the width they leave.

`MessageList` infers the concrete row type from `rows`, including authored fields
and typed tool contracts, and passes it to `renderMessage`. Keep that callback
stable so unchanged rows stay memoized. Give the list a bounded height and
overflow scrolling in app CSS; it follows row updates while at the bottom and
preserves the reader's position when scrolled up. Key it by conversation ID when
a new selection should start at the bottom. Same-ID updates preserve scroll state.
Pass application-owned approval controls as `MessageList` children to keep them
after the rows in that same scrollable transcript. The application still owns
their decision state and callbacks; the list follows child changes only while pinned.
Where `ResizeObserver` is available, the list also follows height changes inside
unchanged rows, including image loads and disclosure expansion, while pinned.
The same observer follows scroll-region size changes, including a height-only
window resize, while pinned.
Reading above the bottom preserves position. The observer disconnects on unmount;
without it, row-update following remains available. The list uses one unstyled
content wrapper inside its existing scroll region.

## Controlled welcome content (private React T22 slice)

`@threadplane/react/chat` exports `Welcome`, `WelcomeSuggestion` and their readonly
props. `Welcome` presents controlled `title`, `children` and `suggestions` slots,
plus optional `className`. An undefined title uses the default `<h2>How can I
help?</h2>`; `null` or `false` omits title content. Absent, null or false
suggestions omit suggestion content. The children slot retains mounted identity
when the title or suggestions change, so a composed `ChatInput` keeps its textarea.

`WelcomeSuggestion` requires literal `label`, exact string `value` and
`onSelect(value)`. Its native `type="button"` never submits a surrounding form;
an enabled, unclaimed click emits the value without trimming or transformation.
Optional `description` supplies the tooltip and accessible description. Optional
`icon` is decorative, hidden from assistive technology, and should contain only
noninteractive phrasing content. `disabled` prevents selection only when strictly
true; `className` customizes presentation. Text remains literal.

These views own no session, subscription, draft, visibility, focus, command or
submission lifecycle. The app chooses when to show the greeting and how selection
affects its draft. Native React dogfoods a separate bounded T23 composition that
prefills and focuses the existing input, leaving sending explicit. Styles remain
opt-in through `/chat/styles.css`. This private, unpublished slice does not establish
full T22/T23 or legacy welcome parity.

## Controlled suggested replies

`Suggestions`, `SuggestionItem` and `SuggestionsProps` are available from
`@threadplane/react/chat`. Supply a readonly array of literal `id`, `label` and
`value` items and `onSelect(value)`. Selection emits the exact untrimmed value;
it never sends, fills a draft or moves focus. IDs must be unique (duplicates
throw `TypeError`); duplicate labels and values are allowed. An empty array
renders nothing. The native button group defaults to the accessible label
`Suggested replies`; `label` and `className` customize the group. Group or item
`disabled` prevents selection only when strictly true, and claimed clicks are
ignored. Native React uses app-authored follow-ups after a local successful text
response. The app owns runtime eligibility, live draft protection and submission
occurrence checks. This does not generate AI suggestions or establish full parity.

## Controlled conversation lists

The private `ThreadList` view from `@threadplane/react/chat` renders supplied
conversation rows without owning their data or selection:

```tsx
<ThreadList
  threads={loadedThreads}
  activeThreadId={selectedId}
  onSelect={selectThread}
  onNewThread={requestNewThread}
  newThreadDisabled={creating}
  newThreadLabel="New"
  label="Loaded conversations"
/>
```

`ThreadListItem` has a readonly `id` and optional plain-text `title`; a missing
or empty title falls back to the full ID. The readonly collection keeps its
supplied order. Provide unique stable IDs so surviving rows retain their DOM
through reordering and updates. Selection requests pass the exact ID to
`onSelect`; only the supplied `activeThreadId` controls `aria-current`. There
are no automatic commands on mount, rerender or removal.

The view renders a named semantic list of ordinary buttons, with default label
“Conversations”, scoped wrapping/focus styles and optional list `className`.
Supplying `onNewThread` adds a native creation button before the list, inside an
outer wrapper. Without that callback, only the list is rendered. Its default
plain-text label is “+ New thread”; `newThreadLabel` customizes it and
`newThreadDisabled` disables only that action. Activation synchronously requests
creation without changing rows or selection. The application owns creation,
pending state and any resulting selection; callback identity changes preserve
existing rows.

Optional readonly `updatedAt` values are epoch milliseconds. Valid timestamps
render on a second line as “just now”, floored minutes or hours, then singular
or plural days. The semantic `time` includes its exact ISO instant and describes
the button without changing its title-based accessible name. Missing or invalid
dates omit this metadata, including when the reference time is invalid. Epoch
zero and negative dates are supported. Optional readonly `now` supplies a numeric
reference time; otherwise `Date.now()` is sampled once per render. The owner
rerenders to refresh relative labels. The view owns no timer or data refresh.

Optional readonly boolean `pinned` presents a pin only for strict `true`. A
decorative current-color icon precedes title content, and “Pinned conversation”
describes the button before any relative time. Its accessible name and tooltip
remain the original title or ID, including with custom or empty title content.
Invalid timestamps still leave pin status available. Pin presentation preserves
supplied order and adds no action, mutation, sorting or focus target.

Optional readonly `renderItem(thread, isActive)` replaces the entire content of
its ID-keyed list item. It receives the original supplied item and exact active-ID
comparison, and returns ReactNode content. `null`, `false` and `undefined` leave an
empty item without default fallback. The default selection button, pin/time
presentation, `renderTitle`, `renderActions` and `onContextMenu` are bypassed for
custom rows. The outer list and optional New button retain their behavior.

The application supplies its own controls, accessible names, active indicators,
selection callbacks and context handling. Return list-item content, rather than
another `li`. Render callbacks must be pure; React may evaluate them repeatedly.
Put hooks inside a returned component. Normal keyed React reconciliation preserves
surviving same-type content when a callback changes; switching between default and
custom rows may replace the subtree. Omit `renderItem` to retain the default rows.
Native compact navigation dogfoods complete application-owned selection rows while
preserving full names, pin/time descriptions, supplied order and retained sessions.

Optional readonly `renderTitle` receives the original supplied `ThreadListItem`
and returns ReactNode title content inside the existing button. Supply only
noninteractive phrasing content (for example `mark` or `em`); do not nest links,
buttons or focusable controls. The original `title || id` remains the tooltip and
accessible name regardless of custom content. `null` and `false` intentionally
render no title content, with no fallback; timestamp descriptions remain intact.
Omitting the callback preserves the default markup. This supports bounded title
content, while broader row templates remain open.

Optional readonly `renderActions` receives the original supplied `ThreadListItem`
and returns ReactNode content beside the selection button, in a separate sibling
wrapper. Use it for application-owned interactive controls with their own
accessible names, callbacks and pending/error feedback. Activating these controls
does not select the conversation. `null`, `false` and `undefined` omit the action
wrapper; other ReactNode values are preserved. Omitting the callback preserves
the original row markup. The view owns no menu or action execution.

Optional readonly `onContextMenu` receives the exact conversation ID and original
React mouse or keyboard event from the selection button. Right-click, the
Context Menu key, and Shift+F10 request it without selecting the row. The owner
decides whether to call `preventDefault()` and open a menu. Claimed, repeated,
composing, and unrelated modified keyboard events are ignored. Action siblings
and the New button are not intercepted. Omitting the callback preserves native
context-menu behavior. Capture `event.currentTarget` synchronously when it will
serve as the menu's invoking element.

An empty collection renders an empty list. The application owns loaded-title
filtering, loading/error/empty notices, data fetching and execution. Native Delete
uses the existing action slot; shared project catalogs, broader drag interaction parity and live timestamp refresh remain future work. This is a bounded private T29 slice.

## Controlled conversation rename editor

`ThreadRenameForm` is a private controlled inline editor from
`@threadplane/react/chat`. Supply `value`, `onValueChange`, `onSubmit` and
`onCancel`; optional `label`, `className`, `pending` and `error` describe the
application-owned operation. The form focuses and selects its input on mount,
retains that input across controlled updates, and provides Save and Cancel.
Whitespace-only values cannot submit. Enter submits outside IME composition;
Escape requests cancellation before an enclosing drawer handles it. Blur never
submits. Pending disables input and Save while leaving Cancel available.

The application trims and validates the requested title, compares it with the
current title, persists it and owns pending/error/retry state. The form makes
no backend requests and does not await command promises. Compose it in the
ThreadList action sibling, outside the selection button. The native example
uses it for confirmed metadata renames without selecting or reloading a session.
Cancelling a pending editor ends local editing interest; it cannot promise a
remote write was rolled back. Project mutation and full
thread lifecycle parity remain open.

The native example also composes app-owned Pin/Unpin commands through the same
action slot and controlled menu. It updates supplied `pinned` metadata only after
the exact target and strict boolean value are confirmed by the backend. Pending,
success and failure feedback belong to the application; the pin item is disabled
while its mutation is pending, and the same command permits explicit retry after
failure. Copy, Rename and selection remain available. Confirmed pin/unpin updates
application-owned grouping and never starts, reloads or stops a session. The compact rail reflects
the shared pinned state while keeping selection-only controls.

The native application also composes confirmed Archive/Unarchive through the same
slots. It partitions its loaded rows into active and archived lists, shares the
loaded-title filter, and keeps the compact rail active-only. Archive metadata and
commands belong to the native application, with strict boolean write confirmation,
per-target pending state, retry after failure and feedback retained across row
migration. Archiving the selected row preserves its transcript, draft, session and
active response. This adds no ThreadList field, lifecycle API or export;
shared project catalogs, broader drag interaction parity and full T29/T30 parity remain open.

The native application orders active loaded pins first by finite numeric
`metadata.pinnedOrder`, retaining stable ties, placing unranked pins last and
preserving unpinned relative order. Full and compact views filter after ordering;
archived rows retain supplied order. Move up/down commands use all loaded pinned
neighbors, including hidden filtered rows, and patch only changed ranks within
that captured slice of at most 50 loaded conversations. This is application-owned
composition; ThreadList still renders supplied order unchanged. It adds no library
API or export. Rank writes are not atomic: partial or unconfirmed results preserve
the last locally known order and require an explicit successful Refresh admitted
after settlement before another move. Only moves are blocked during pending or
unconfirmed ordering. Directory-owned target feedback survives filtering and
movement; remounts share active recovery state without replaying completed outcomes.
Moves preserve keyed rows, selected session, draft and running response.

## Controlled confirmation dialog

The private chat entry exports `ConfirmDialog` and readonly `ConfirmDialogProps`.
Supply controlled `open`, literal `title`, synchronous `onConfirm` and `onCancel`;
optional `body`, `confirmLabel`, `cancelLabel`, `tone` (`normal` or `destructive`),
`pending`, `className` and `returnFocusTo` customize the intent UI. Opt-in chat CSS
styles the dialog and backdrop. Native `showModal()` provides top-layer background
inertness; Cancel receives initial focus, enabled buttons wrap at Tab boundaries,
and Escape or an outside-bounds backdrop click requests cancellation. Pending
marks busy and disables Confirm while leaving Cancel available. Controlled refusal
to close retains modal ownership. The component owns no HTTP or command promises.

A hidden marker supplies the owner document and local theme, font and direction;
the dialog portals to that document's body. SSR renders no open modal. Stable nodes
survive controlled updates. Cleanup restores an available same-document invoker
only while the modal owns focus, preserving deliberate focus elsewhere. This is a
bounded private T22 primitive, not a complete overlay-stack manager.

Native React composes permanent conversation Delete through this dialog with an
immutable title/ID/request identity and closes it before dispatch. Cancel never
implies rollback of an admitted delete. Exact-target 204 acknowledgement or explicit
status-check 404 retires a conversation; uncertain outcomes retain a shared barrier
and **Check deletion status** recovery. Exact-ID presence restores writes without
reloading the selected session. Pending/uncertain deletion blocks global Delete and
reorder, plus matching metadata/composer writes; other rows stay usable. Selected
running/reconnect evidence refuses deletion. Retirement tombstones survive stale
reads for the owner lifetime; confirmed selected idle deletion clears only matching
selection/session/route, while nonselected deletion preserves the current draft
and running response. The ThreadList row API is unchanged; full T29 parity remains open.

## Controlled command menu

The private chat entry also exports `OverflowMenu`, `OverflowMenuProps` and
`OverflowMenuItem`. Supply readonly ordered items with unique stable string IDs
and literal labels, required `label`, controlled `open`/`onOpenChange`, and
`onSelect(itemId, event)`:

```tsx
<OverflowMenu
  label="Conversation actions"
  items={[{ id: 'copy', label: 'Copy conversation ID' }]}
  open={open}
  onOpenChange={setOpen}
  onSelect={(itemId, event) => copyFromGesture(itemId, event)}
/>
```

Optional `disabled`, `className` and item `disabled`/`tone: 'normal' | 'destructive'`
control presentation. Only strict `true` disables controls. Selection requests
closure and synchronously passes the original React button mouse event,
preserving user-gesture capabilities such as the item's
`currentTarget.ownerDocument` clipboard. The app owns async work, errors and
status; the component never awaits command promises.

The named menu portals to the trigger document body. Arrow keys wrap enabled
items, Home/End select edges, and native Enter/Space activate. Escape closes the
menu before a containing drawer; accepted command/Escape closure returns focus
when still menu-owned. Tab/Shift+Tab continue from the trigger's natural order.
Outside pointer/focus, external scroll and viewport resize request dismissal.
Hidden, inert, disabled, disconnected or unlaid-out anchors suppress the portal
until an accepted closed/open cycle, even if the owner refuses closure. Effective
ARIA reflects the mounted portal. Opening snapshots local direction, font,
color-scheme and chat/design tokens; ancestor theme changes dismiss the menu.
Import the chat stylesheet for fixed viewport-clamped placement and 40px targets.

Optional readonly `anchorPoint` supplies readonly numeric `x`/`y` coordinates in
the trigger document's viewport. A finite point places the menu beside that point,
following local direction, flipping above when needed and retaining the 8px
viewport margin. Missing, null or nonfinite coordinates use the trigger instead.
Point changes remeasure the existing menu without replacing its focused item.
The trigger must still be available, including for point-anchored menus.

Optional readonly `returnFocusTo` supplies an invoking `HTMLElement` for accepted
command/Escape closure and natural Tab/Shift+Tab traversal. It must be available
in the trigger's document and able to take focus; otherwise the trigger is used
when available. Deliberate focus outside the menu is preserved. The owner controls
the point, invoker and open state, and should associate close callbacks with the
current request so an old callback cannot dismiss a newer menu for the same ID.

The Node rendering check covers DOM-free import and pre-mount trigger rendering,
including `open=true`; it is a bounded check, with no broader hydration claim.
Native full directories compose pointer and keyboard context menus for one
exact-ID clipboard command and an app-owned rename editor; compact navigation
remains selection-only. Further lifecycle/project commands and full parity
remain open.

Typing in an open menu or select list moves focus to the next enabled entry
whose label starts with the typed text. Characters typed within half a second
extend the search, repeating one character cycles through the entries that start
with it, and an arrow key or closing starts over. Matching ignores case and
select descriptions. Typing only moves focus: it never selects, and Space still
activates the focused entry.

## Controlled message rating

`MessageRating` renders thumbs up and down for one identified response as a named
group of two native toggle buttons. It is fully controlled: `value` is `'up'`,
`'down'` or `null`, and `aria-pressed` reflects only that value. Activating an
option calls `onValueChange(next, messageId)`, where `next` is the requested
rating, or `null` when the current rating is pressed again. The owner decides
whether to accept, store or send it; a refused request leaves the display
unchanged. The component keeps no state, sends nothing and stores nothing.

`MessageRatingProps` has eight readonly fields: required `messageId`, `value` and
`onValueChange`, plus optional `disabled`, `label`, `upLabel`, `downLabel` and
`className`. The defaults are **Rate response**, **Good response** and **Poor
response**. Labels are literal strings; each is the button's accessible name and
its native `title`. `disabled` disables both options while the accepted rating
stays visible. The group carries `data-message-id` for styling and tests.

The glyphs are built in and decorative. With the opt-in chat stylesheet, options
use the same compact 36px targets as icon-only `MessageActions`, and the pressed
option has a distinct border, background and text color with a forced-colors
fallback. Without the stylesheet, labels remain visible beside the glyphs.

```tsx
import { MessageRating, type MessageRatingValue } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

export function AnswerRating({ messageId, value, onRate }: {
  readonly messageId: string;
  readonly value: MessageRatingValue | null;
  readonly onRate: (value: MessageRatingValue | null, messageId: string) => void;
}) {
  return <MessageRating messageId={messageId} value={value} onValueChange={onRate} />;
}
```

Use the stable row identity from `MessageList` (`row.id`) and scope stored ratings
to their conversation. This private feature does not add copy or regeneration
commands, a feedback backend, or public release parity.

## Controlled select

The private chat entry also exports `Select`, `SelectProps` and `SelectOption`.
Supply readonly ordered options with unique string values and literal labels, a
controlled `value` with `onValueChange(value, event)`, controlled
`open`/`onOpenChange`, and a required `label` naming the list:

```tsx
<Select
  label="Response tone"
  placeholder="Tone"
  options={[
    { value: 'plain', label: 'Plain', description: 'Short sentences' },
    { value: 'formal', label: 'Formal' },
    { value: 'playful', label: 'Playful', disabled: true },
  ]}
  value={tone}
  onValueChange={setTone}
  open={open}
  onOpenChange={setOpen}
/>
```

The trigger shows the label of the option whose value equals `value`, or
`placeholder` (default `Select`) when none does. An option the owner has not
accepted is never shown as selected: activating an option requests closure and
then calls `onValueChange` with its literal value and the original React button
mouse event, and the displayed selection changes only when the owner supplies
the new `value`. Activating the current value only closes the list. Selecting
never performs work by itself; changing a backend model, sending a message or
persisting a preference stays an explicit application command.

Optional `disabled`, option `disabled`, `className` (trigger) and
`menuClassName` (list) control presentation. Only strict `true` disables.
Option labels and descriptions are literal text.

The list is a named `listbox` of native option buttons, portaled to the
trigger document body so an ancestor's `overflow` or `transform` cannot clip
it. It prefers the space above the trigger, as a composer usually sits at the
bottom of the viewport, uses the space below when that does not fit, and
stays within an 8px viewport margin. Opening focuses the selected enabled option, otherwise the first
enabled one. Arrow keys wrap across enabled options, Home/End select edges and
native Enter/Space activate. ArrowDown on the trigger opens the list like a click; ArrowUp opens it at
the last enabled option. Escape closes from an option or the trigger
before a containing panel and returns focus to the trigger; Tab continues from
the trigger's natural order. Outside pointer/focus, external scroll and
viewport resize request dismissal, and unavailable anchors suppress the portal
exactly as for the command menu, with which it shares one private engine.
Import the chat stylesheet for fixed placement and 40px targets; without it the
list renders in normal flow at the end of the document body.

Compared with Angular `chat-select`, the two-way `value` binding becomes
explicit `value`/`onValueChange`, list visibility is owner-controlled,
`menuLabel` is the required `label`, and `panelClass` is `menuClassName`.
A model-select slot on the `Chat` composition is not provided.

## Controlled chat panels

`ChatPopup` is a private non-modal shell from `@threadplane/react/chat`:

```tsx
import { useState } from 'react';
import { Chat, ChatPopup } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

function Support() {
  const [open, setOpen] = useState(false);
  return (
    <ChatPopup open={open} onOpenChange={setOpen} title="Support">
      <Chat session={session} content={content} />
    </ChatPopup>
  );
}
```

The application owns visibility. The launcher, Close button and unclaimed Escape
inside the panel request changes through `onOpenChange`; accepted `open` changes
control visibility and focus. Opening focuses Close; closing returns focus to the
launcher unless another page control already has focus. `launcherLabel`,
`closeLabel`, `closeOnEscape` and `className` customize the shell.

Closed children remain mounted, hidden and inert. Drafts and borrowed subscriptions
survive closing; a running response continues. Closing never stops or disposes the
session or app-owned content. The application still owns Stop and final disposal.
Changing the selected conversation can independently reset its composer.

The dialog has a generated title relationship, ordinary non-modal Tab order and
viewport-bounded scrolling. It uses the same scoped chat stylesheet and tokens.
Mount it outside transformed or clipping ancestors: this first slice uses fixed
positioning in its existing DOM location, with no portal, backdrop, focus trap,
global shortcut or persisted open state.

`ChatSidebar` uses the same controlled props and retained-child behavior as
`ChatPopup`. Import it from the same `/chat` entry and replace `ChatPopup` in the
example above to use a full-height panel at the viewport's inline end. Its width
is 28rem on larger screens and the full viewport width at 640px and below. The
launcher hides while open; Close and scoped Escape request closure, then focus
returns to the launcher when appropriate. The surrounding page stays interactive
and Tab can leave the panel.

The sidebar overlays the page by default. To keep page content beside the open
panel on wider screens, pass that content as `pageContent` and set `pushContent`:

```tsx
<ChatSidebar open={open} onOpenChange={setOpen} title="Conversation"
  pageContent={<ConversationDirectory />} pushContent>
  <ConversationView />
</ChatSidebar>
```

`children` remains the chat panel content. The persistent page slot and panel
retain their mounted children when visibility or the layout preference changes.
The layout reserves 28rem at the inline end only while open with `pushContent`;
closing or disabling it restores the page width. At 640px and below it always
overlays with no reservation. Reservation applies only inside this sidebar's
layout wrapper; it does not coordinate peer panels or claim global page edges.
`className` still customizes the popup shell. Peer-panel edge claims, SSR,
hydration and public release remain separate work. Both panels are private
contributor APIs.

### Controlled conversation navigation

The private `/chat` entry also exports `ChatSidenav`, `ChatSidenavMode`,
`ChatSidenavProps`, `ChatSidenavScrim` and `ChatSidenavScrimProps`. The navigation
shell accepts application-owned navigation as `children`:

```tsx
<>
  <ChatSidenavScrim
    open={mode === 'drawer' && drawerOpen}
    onDismiss={() => setDrawerOpen(false)}
  />
  <ChatSidenav
    mode={mode}
    open={drawerOpen}
    onModeChange={setDesktopMode}
    onOpenChange={setDrawerOpen}
  >
    <ConversationDirectory />
  </ChatSidenav>
</>
```

Required `mode` selects `expanded`, `collapsed` or `drawer`; `open` controls only
the drawer. Expanded and collapsed navigation stay in normal flow at 18rem and
4rem. The drawer sits at the viewport's inline-start edge, is at most 20rem wide, and
uses a named non-modal navigation landmark with no built-in scrim or focus trap. The
application chooses modes and owns responsive breakpoints and persistence.
The consumer provides a bounded desktop height and lays out sibling content.
`onModeChange` requests only `expanded` or `collapsed`; the launcher, Close and
scoped Escape request drawer visibility through `onOpenChange`. Accepted props
determine visibility and focus. An open drawer focuses Close; hiding focused
content returns focus to the visible launcher or toggle while preserving external
control focus.

Children stay mounted across every mode. Collapsed content and closed drawers are
hidden and inert, retaining filters, drafts and borrowed subscriptions. The shell
does not select conversations, send commands or own session data. Optional
`label`, `launcherLabel`, `closeLabel`, `expandLabel`,
`collapseLabel` and `className` customize its accessible labels and styling.
Defaults are Conversations, Open conversations, Close conversations, Expand
conversations and Collapse conversations. Use the existing scoped chat stylesheet.

Optional readonly `collapsedContent?: ReactNode` supplies a persistent compact
content tree, visible only in collapsed mode independently of `open`. The full
children tree stays mounted, hidden and inert while collapsed; compact content
stays mounted, hidden and inert when expanded or in either drawer state. Omitting
the prop renders no compact wrapper; explicit `null` or `false` stays empty.
The shell owns no compact selection or data. Focus from disappearing compact
content moves to the expanded toggle or closed-drawer launcher; opening a drawer
continues to focus Close. External focus is preserved.

Optional readonly `toggleShortcut?: boolean` enables Ctrl+B or Command+B only
when explicitly `true`. It requests the opposite desktop mode through
`onModeChange`; the application still decides whether to accept that change.
The desktop toggle advertises `Control+B Meta+B` through `aria-keyshortcuts` and
an action tooltip. Drawer mode leaves the chord unclaimed. Editable fields,
composition, repeats, Alt/Shift-modified chords and already handled events are
ignored. Only a connected shell outside hidden/inert ancestors can claim it;
the first eligible opted-in shell in the same window handles the event. Omitting
the option adds no global shortcut listener or shortcut attributes.

Optional readonly `onSearch?: () => void` adds a Search conversations button.
The callback receives no arguments and owns what searching means; the shell does
not change mode, open a dialog, focus a field or run a query. Optional readonly
`searchLabel?: string` changes the full accessible name, visible label and tooltip.
The collapsed rail shows a magnifier while retaining the full accessible name.
The action remains mounted inside the navigation and is hidden/inert with a
closed drawer.

Optional readonly `searchShortcut?: boolean` enables Ctrl+K or Command+K only
when explicitly `true` and `onSearch` is supplied. It requests search in every
mode, including a closed drawer. The button advertises `Control+K Meta+K` and a
tooltip hint when enabled. It shares the toggle shortcut's editable, composition,
repeat, modifier, claimed-event and eligible-owner protections. Both shortcuts
use one listener per shell while either is enabled; callback replacements and
mode changes preserve its registration priority. Supplying a label or shortcut flag without a callback
adds no Search button and claims no search chord. Accepted drawer closure returns
focus from Search to the launcher; the application owns search focus otherwise.

`ChatSidenavScrim` is an optional sibling backdrop, rendered only when its required
`open` prop is true. It is an ordinary keyboard-accessible button; activation calls
the required `onDismiss` callback without changing visibility itself. Optional
`label` defaults to Close conversation navigation backdrop; `className` customizes
styling. Its fixed viewport coverage sits below the drawer and above the page.
Mount both outside transformed or clipping ancestors and enclosing stacking
contexts. The application owns visibility and focus restoration when the focused
backdrop is removed. The primitive adds no Escape listener, focus trap, background
inertness, portal or session behavior; adding it does not make navigation modal.

The native React example opts in with exact `?presentation=sidenav`, keeps the
conversation inline, and chooses drawer mode at widths of 700px and below.
It composes the sibling scrim only while the drawer is open, restores local focus
after backdrop dismissal, and removes the backdrop on desktop mode changes.
Its directory filter and composer survive navigation visibility and breakpoint
changes; selecting a different conversation deliberately resets that composer's
draft. It opts into the desktop toggle shortcut while preserving those owners.
This is a bounded children-based navigation slice. Project menus,
backend search, other global shortcuts, debug ownership and full
Angular composition parity remain open under T30. The native Search loaded
conversations action reveals navigation and opens the loaded-title palette once
per explicit request, without adding backend search or commands.

### Controlled loaded-conversation search

The private `@threadplane/react/chat` entry exports `HistorySearchPalette`,
`HistorySearchPaletteProps` and `HistorySearchResult`. Supply controlled `open`,
`query`, readonly `results` and `onQueryChange`, `onSelect`, `onClose` callbacks.
Results have unique exact `id`, literal `title` and optional `subtitle`; the
caller owns filtering, supplied order, loading and accepted navigation. The
primitive never fetches or filters. `loading` retains the list but suppresses
active selection. Query changes or removal choose the first available result;
reordering retains the active ID. Arrow keys move without wrapping; Enter picks.

The palette portals a native modal dialog into its owner document, inherits local
theme and direction, contains focus and restores an available invoker (or
`returnFocusTo`). Close, Escape and backdrop activation emit `onClose`;
composition, claimed and modified/repeated activation keys are guarded. SSR
renders a hidden marker without DOM globals or callbacks. Import chat styles.

Native React dogfoods title search among up to 50 loaded rows across projects
and archives. Its inline filters remain independent until an explicit pick,
which reveals the selected row and uses the existing application selection path.
This bounded private slice does not provide backend-wide search or full T29/T30
parity.

## Read-only render trees

The private `@threadplane/react/render` client entry exports `RenderSpec`.
Prepare and validate a plain-data tree in application composition, then supply
an authored registry and explicit immutable state:

```tsx
import { RenderSpec, type ReactRenderRegistry } from '@threadplane/react/render';

const registry: ReactRenderRegistry = {
  Title: ({ props }) => <h2>{String(props['text'] ?? '')}</h2>,
};
const spec = {
  root: 'title',
  elements: { title: { type: 'Title', props: { text: { $state: '/title' } } } },
} as const;
<RenderSpec spec={spec} state={{ title: 'Trip recap' }} registry={registry} />;
```

`RenderSpecData`, `RenderElementData`, `RenderSpecProps`, `RenderViewProps`,
`ReactRenderRegistry` and `RenderValue` describe readonly inputs and view values.
Views receive owned, recursively frozen `props` and `bindings`, ordered children,
`elementKey` and `loading`. Missing expressions can resolve to `undefined`.
Caller data is never frozen or mutated. Null specs, missing roots, hidden elements
and unknown types without a supplied `fallback` render nothing. Element and
registry lookup uses own keys; cyclic child paths are cut off. Duplicate sibling
IDs or repeat identities throw a contract error.

The adapter reuses the pinned `@json-render/core` expression, visibility and binding
resolvers. Repeat containers render their children per array item, with `$item`,
`$index` and absolute nested state paths. An own string or finite-number repeat
key preserves mounted identity across reorder; absent or unsupported keys use the
item index. String, number and index identities have separate namespaces.

Supply an optional `functions` map for authored `$computed` expressions:

```tsx
import type { ReactRenderFunctions } from '@threadplane/react/render';

const functions: ReactRenderFunctions = {
  uppercase: ({ value }) => String(value).toUpperCase(),
};
const computedSpec = {
  root: 'title',
  elements: {
    title: {
      type: 'Title',
      props: { text: { $computed: 'uppercase', args: { value: { $state: '/title' } } } },
    },
  },
} as const;
<RenderSpec spec={computedSpec} state={{ title: 'Trip recap' }} registry={registry} functions={functions} />;
```

`RenderComputedFunction` receives an owned, recursively frozen argument record
and synchronously returns `RenderValue`. Literal, state, item, index and nested
computed arguments use the existing resolver. Function results cross the same
plain-data ownership boundary as other resolved values. Promises, executable
callbacks and non-plain results are rejected. Calculations must be pure: React
can evaluate them repeatedly during rendering, and no call count, caching or
effect behavior is promised. Callback errors propagate as render errors.

Function maps must be plain records or null-prototype records. Every own
string-keyed callable data property is registered, including non-enumerable
entries; inherited names are unavailable. Accessors, symbol keys and non-callable
entries are rejected without invoking getters. The caller's map and data remain
unfrozen and unmodified. Unknown function names resolve to `undefined` with the
upstream warning behavior. This optional host map does not permit executable
callbacks in raw specs or add actions, watchers or state ownership.

The same entry exports the type-only `RenderReadinessEntry`. Direct function,
`memo` and `forwardRef` registrations still receive missing values as `undefined`.
An optional readiness descriptor delays one view's initial admission:

```tsx
import type {
  ReactRenderRegistry, RenderReadinessEntry, RenderViewProps,
} from '@threadplane/react/render';

// Keep the component and predicate identities stable outside rendering.
function Value({ props }: RenderViewProps) {
  return <output>{String(props['value'] ?? '')}</output>;
}
const valueEntry: RenderReadinessEntry = {
  kind: 'readiness',
  component: Value,
  isReady: (props) => typeof props['value'] === 'number',
  fallback: () => <span>Waiting for a value…</span>,
};
const readinessRegistry: ReactRenderRegistry = { Value: valueEntry };
```

`isReady` receives the owned, recursively frozen resolved prop record. It must be
pure and return a synchronous boolean; React may evaluate it repeatedly. Errors
propagate, and promises or other non-boolean results throw `TypeError`. This is
app-authored admission, without automatic Standard Schema or all-props-defined
validation. While pending, the descriptor fallback receives current `props`,
`bindings`, `elementKey` and `loading`, without children; absent fallback renders
nothing. The top-level `RenderSpec` fallback remains separate and handles unknown
registry types.

Only a successful real-view commit latches admission. Later ordinary missing
values, prop, binding or loading updates retain that view's actual DOM and local
state and skip further predicate calls. An initially suspended or abandoned
candidate cannot latch. Element key, element type, component or predicate identity
changes reset admission and remount even when the component is otherwise the
same. Equivalent registry/descriptor objects and fallback-only changes retain
admission; a committed pending replacement retires the old lifetime even if its
contract later returns. Hidden or missing elements, null specs, removal and
transitions to direct registrations reset the lifetime. Stable repeated keys retain
it. StrictMode effect cleanup does not reset admission or issue owner commands.

This private client contract adds no observation or owner lifetime: the app owns
state writes, commands and disposal. Forms, catalog views, actions, automatic
schema validation, SSR, hydration, public release and full legacy parity remain
outside this readiness slice.

State and resolved values must be finite, acyclic plain data. Functions, symbols,
accessors and non-plain objects are rejected. Raw props also reject `undefined`
and own `__proto__` keys because the upstream raw-prop resolver cannot preserve
that key; state-bound objects preserve empty and special own keys. These guards
are not application-schema validation. Validate untrusted trees before rendering.

The view does not parse JSON, observe owners, create a store, execute actions,
evaluate watch effects or manage disposal. It omits forms, action providers,
automatic schema validation, A2UI, telemetry, SSR and hydration. Native React
dogfoods this bounded feature by preparing the existing typed terminal trip
recap outside rendering. This is not arbitrary streamed JSON rendering or full
render parity. The root entry stays headless.

## Private Debug first slice

`@threadplane/react/debug` exports `ChatDebug` and narrow readonly data types.
Import `@threadplane/react/debug/styles.css` explicitly for the scoped panel CSS.
Root and chat imports carry no Debug JavaScript or styles.

```tsx
import { ChatDebug } from '@threadplane/react/debug';
import '@threadplane/react/debug/styles.css';

<ChatDebug
  contextKey="application-owner"
  current={{ contextKey: 'application-owner', status: 'ready', values: {} }}
  storageKey="my-app:debug-ui"
/>;
```

This passive, nonmodal view presents current application values and an app-owned
checkpoint page of at most ten metadata rows. Unknown/unavailable current state
is distinct from observed `{}`; an unloaded page is distinct from an empty page.
The app controls `selection` and supplies separately keyed `inspection` results.
Context, page generation and row key must match before historical values/errors
are displayed. The UI never interprets SDK checkpoint objects.

`onRefresh` and `onInspect` are synchronous notifications returning `undefined`.
Each explicit action supplies its complete ownership token; application code
validates it and starts any separately owned read. Rendering, mounting, opening,
tabs, docking, closing and unmounting issue no reads, runs or disposal. The app
owns network access, stale-result validation, selection and resource lifetime.
History order is as supplied, with no automatic paging or live branch-tree claim.
Fork, replay, comparison between historical checkpoints and full T29 parity
remain outside this private slice. When the selected inspection and current
observation are both ready and match the panel's ownership tokens, the State tab
offers **Compare selected checkpoint with current state**. The inspected
checkpoint is the before state; the current observation is the after state.
Opening the comparison performs no additional read.

Displayed plain JSON is bounded to depth 6, 200 entries, 2,000 Unicode code points
per string/key and 32 KiB of UTF-8 output. Truncation is disclosed separately from
valid JSON. Copy awaits clipboard success/failure and copies exactly the displayed
projection, never a complete-raw-state promise. Only visited prefixes are validated;
SDK decoding and caller allocation happen before this display bound. Invalid
visited data is unavailable. Plain app-owned data excludes executable objects,
accessors and proxies; this view is not an SDK validation boundary.

The panel's own data/default props produce deterministic server markup and can
hydrate independently of `useAgent`; this does not extend the hook's SSR contract.
After hydration, a supplied application-scoped `storageKey` restores only open,
dock and tab preferences, tolerating denied storage. Defaults never overwrite saved
preferences during hydration. State, history, IDs, target and selection are never
persisted. Use separate keys for independent panels. Scoped Escape handling and
outside-click close retain outside focus. Outside actions activate before dismissal
so a host layout change cannot move their targets before the click. User-close
restores the launcher only while focus remains owned by that panel.

### Passive state comparison (private React Debug)

`StateDiff` and readonly `StateDiffProps` are also available from
`@threadplane/react/debug`, using the same explicit stylesheet. Supply `before`
and `after` as `DebugValue`; optional `label` and `className` control presentation.
The view has no reader, execution, subscription or clipboard capability.

Both inputs must fit the existing 32 KiB, depth-six, 200-entry and 2,000-code-point
display limits completely. Invalid inputs, inputs exceeding those limits, and
change lists exceeding the same limits receive distinct unavailable notices.
The view never compares truncated prefixes or displays partially projected
changes as if they were complete. Only complete equal states report no changes.

Changes identify added, removed and changed own properties with escaped JSON
Pointer paths; the empty path identifies the root. Object property order is
irrelevant, including inside arrays. Changed arrays are shown as whole values.
Missing properties remain distinct from null, false and empty strings. The JSON
output is literal and bounded; this is app-owned plain-data comparison, not SDK
decoding or hostile Proxy isolation.

### Loaded project navigation (private React T29 slice)

`ProjectList` from `@threadplane/react/chat` presents a readonly supplied
`ProjectListItem[]` (`id`, `name`) with controlled `activeProjectId` and
`onSelect(projectId)`. It preserves supplied order and exact IDs, renders names
as literal text (empty names fall back to ID), and marks the active button with
`aria-current`. `label` and `className` customize the list. Optional
`onNewProject`, `newProjectLabel` and `newProjectDisabled` expose an application-owned
request; the primitive performs no creation or persistence. Use unique project IDs.

Native React merges browser-local catalog entries with first-seen nonblank
`metadata.projectId` values among loaded conversations, including archived rows.
IDs retain their exact bytes; local names fall back to IDs when not saved in this
browser. Selecting a project filters active, archived and compact rows alongside
the existing title filter. All conversations resets only the project filter.
The selected transcript, draft and running response remain mounted without extra
backend calls. A disappearing project stays selected with an empty filtered view
until reset. New project is always available when local storage is healthy; the
larger project section appears for catalog/loaded entries, a retained filter or an
open editor. Selection is ephemeral, while names persist only in this browser.
New conversations use the selected project as described below, and pinned reordering still spans all loaded
pins, including other projects. Confirmed deletion is described below; shared catalogs and full T29 parity remain open. Confirmed
conversation assignment/removal is described below. See the naming slice below for persistence behavior.

### Project creation and browser-local names (private React T29 slice)

`ProjectList.renderActions(project)` receives the original readonly item and
composes application-owned controls beside selection. Absent/null/false/undefined
output omits the action wrapper. Commands do not implicitly select a project.
`ProjectNameForm` is a controlled editor with `value`, `onValueChange`, `onSubmit`
and `onCancel`; optional `label`, `className`, `submitLabel`, `pending`,
`submitDisabled` and `error` customize presentation. It focuses/selects once,
protects IME input and blank/pending/disabled submissions, and never saves on blur.
Persistence, request lifetime and return focus belong to the application.

Native React now creates and renames projects in the versioned browser-local
`threadplane-native-react-projects-v1` catalog. It displays local catalog entries
first, then first-seen loaded association IDs without duplicates. Renaming a loaded
ID imports its name locally without changing the ID or backend metadata. Names
are trimmed on Save; duplicate names are allowed because IDs define identity.
Catalog-only projects can be selected with an empty conversation view. These are local labels, not a shared server catalog. New conversations use the selected project as described below.

Writes reread and validate the current catalog and publish only after persistence
succeeds. Malformed/unsupported saved data is never replaced; unavailable storage
and write failures keep the draft and target, expose Retry, and block submission
until recovery. Retry reloads without committing. Storage events (including clear)
refresh names without broadening a retained filter or replacing an active draft.
This uses browser localStorage's last-writer-wins behavior, not atomic multi-tab
transactions. This naming catalog has no cross-device sharing. The association slice below
uses explicit backend conversation metadata commands.
Project selection, naming and persistence preserve the selected conversation,
transcript, composer draft and running session without extra network calls.
Confirmed project deletion is described below; shared catalogs and full T29 parity remain open. Confirmed
conversation assignment/removal is described below.

### Native project action menus (private React T29/T30 slice)

Native full project rows compose the existing controlled `OverflowMenu` through
`ProjectList.renderActions`. Each contextual **More actions** trigger offers
**Rename** and, when a deletion owner is available, destructive **Delete**.
Deletion capability controls the Delete item; unavailable project storage or a
pending project deletion disables the trigger. Opening or dismissing a menu does
not select a project, write data or replace an existing editor draft.

Rename keeps the existing browser-local editor and storage Retry behavior. Delete
keeps the exact-target confirmation and backend membership recovery described
below, preserving conversations. Editors and confirmations retain the persistent
row trigger for focus restoration. Scope changes expire old menu requests; the
existing menu supplies keyboard navigation, dismissal, inherited theme and
viewport containment. This adds no public API or backend contract; shared catalogs
and full T29/T30 parity remain open.

Conversation menus also retain their opening through a queued scroll notification
from an anchor ancestor whose vertical/horizontal offsets already settled before
opening. Actual later ancestor movement, document/unrelated scroll notifications,
outside input and resize still dismiss the menu. The shorter native rail browser
proof covers unchanged queued notification, genuine scrolling, reopening and the
retained pin/unpin flow without retries or added timeouts.


### Confirmed conversation project assignment (private React T29 slice)

Native full active and archived directories now compose an application-owned
**Move to project** command from the existing React row action and selection
primitives. The editor has explicit Save/Cancel and a separate **No project**
choice. Choosing a destination does not write; only Save requests a narrow
`metadata: { projectId }` update. IDs preserve exact bytes, and removal sends
explicit `null`. Success requires the exact raw thread ID and requested metadata
value; an omitted value does not confirm removal. No new library export is needed.

Names remain browser-local; association IDs are persisted by the backend. The
picker merges the validated local catalog with all loaded project IDs. It reloads
on relevant storage events and rereads before Save. Missing destinations keep the
draft choice visible and disable Save; unavailable or malformed catalog storage
requires explicit read-only Retry without replacing saved bytes. Duplicate names
and prototype-like IDs remain literal.

The shared owner publishes per-conversation pending/error/retry state and applies
only a confirmed association. Independent read/write evidence prevents older list
or selected-row reads and unrelated rename/pin/archive/rank responses from
reverting it. Disposal and application replacement retire old UI requests; pending
moves block target deletion. A failed or unconfirmed response retains intent for
explicit retry or Refresh rather than claiming success.

The directory owns the editor and feedback outside filtered rows. Moving a row
out of the current project keeps that filter, selected conversation, transcript,
composer draft and running response. Cancellation may close the editor while an
already dispatched command continues; its completion cannot close a newer editor.
Focus returns only while still owned, using the stable filter when the original
row is hidden. Compact rails remain selection-only. New conversations inherit the selected project as described below. Confirmed project deletion is described below. Shared catalogs, drag
reordering and full T29 parity remain open.


### Conversation creation in the selected project (private React T29 slice)

Native React **New** captures the current project filter and sends its exact ID
in the initial conversation creation metadata. **All conversations** retains the
ordinary creation request without project metadata. Project names remain local
labels; the backend persists the association ID. Creation uses one request and
never follows it with a project-assignment PATCH.

Until a valid new conversation ID and matching project metadata are confirmed,
the previous selection, transcript, composer draft and running session remain
owned by the current conversation. Pending duplicate clicks cannot create a
second request. A failed, cancelled or mismatched response is unconfirmed and
requires explicit recovery; the server may already have created a conversation.

Confirmation publishes the new row and creation state together before selecting
it. Changing project filters while the request is pending neither changes its
captured destination nor resets the newer filter on completion. Existing title
filters also remain intact. Lists begun before creation cannot erase its new row
or revert its confirmed project; fresh post-creation reads remain authoritative.
Navigation, disposal and newer creation intents fence late completions.

The association survives backend reloads; the selected project filter stays
ephemeral. Confirmed project deletion is described below. Shared catalogs, broader drag interaction parity and full T29 parity
remain open. This is private native dogfood with no new library export.

### Confirmed project deletion (private native React T29 slice)

Native React **Delete project** captures an exact project ID and asks for
confirmation. It preserves conversations, including archived conversations and
those outside the 50-row loaded directory. The application searches backend
membership in batches of 50 and clears each association with a confirmed
`projectId: null` metadata update. It repeats the first page as membership shrinks;
it never deletes conversation records or changes their content.

A final empty membership response confirms backend completion. Only then does
the browser remove the project label from the latest observed local catalog.
Pending and uncertain operations retain their captured target. Explicit **Retry
project deletion** rechecks remaining membership, including after an uncertain
write or a failed local catalog save. Partial progress is retained; failure never
claims the entire project was removed. Invalid stored data remains untouched.
The owner bounds each attempt to 200 pages and rejects repeated member IDs rather
than looping indefinitely; an incomplete attempt requires explicit retry.

Selection, transcript, composer draft and running response remain owned by the
current conversation. Successful deletion returns to All conversations only if
the deleted project is still selected; a newer filter is preserved. Independent
read/write evidence prevents older reads from restoring cleared associations.
Pending deletion blocks local creation, project moves and conversation deletion;
an unconfirmed target cannot accept new local associations. Confirmed deleted IDs
also reject incoming local associations for the application owner's lifetime.

The backend has no atomic project-deletion operation: another client can create
or move conversations concurrently, and fresh backend reads remain authoritative.
Catalog updates preserve the latest observed entries without an atomic multi-tab
guarantee. Project names remain browser-local. Shared catalogs, broader drag interaction parity
and full T29 parity remain open; this slice adds no public library export.

### Controlled checkpoint timeline (private React T29 slice)

`@threadplane/react/chat` exports `Timeline`, `TimelineItem` and `TimelineProps`.
Supply readonly `items` with unique exact UI `id`, literal `label`, optional
`description` and `disabled`, plus `onSelect`. `selectedId` remains controlled.
The labelled ordered list preserves supplied order and original objects; default
rows use native selection buttons and disable only strict `true`. Import chat
styles for wrapping, focus and selected-state presentation.

Optional `renderItem(item, isSelected, index)` replaces the complete row, retaining
the keyed list item while bypassing all default controls/content. The callback
owns accessibility and actions; null/false/undefined produces an empty row.
The primitive performs no fetching, filtering, sorting, timers or execution and
renders without browser globals. UI IDs carry only caller-defined selection
identity, not backend checkpoint authority.

Native React composes the last explicitly loaded checkpoint metadata page into a
collapsed disclosure. Inspection is local and preserves the current conversation,
draft, route and active response. Display is bounded to ten rows, ten next-node
names per row and 512 UTF-16 units per string, with truncation disclosed. Missing
and duplicate backend IDs remain distinct occurrences. New owner, conversation
or page identities retire old selections and callbacks. This slice displays only
metadata; historical values, replay/fork, live branch timelines and full T29
parity remain open.

### Native pinned conversation drag ordering (private)

Native React full active directories now compose desktop drag handles beside
pinned conversation actions. Drop above or below another visible pin to use the
existing confirmed rank command. The destination uses the complete loaded pinned
order, including neighbors hidden by title or project filters. The controlled
ThreadList still renders supplied order; this adds no library prop or export.

Only visible active pins are drag targets. Archived, unpinned and compact rows
have no handles; fewer than two visible pins disables dragging. Keyboard and
touch users retain Actions → Move up/Move down. This does not claim touchscreen
dragging or general drag-and-drop parity.

Hover and cancellation issue no commands or network reads. A valid move keeps
the last confirmed display until every rank write is acknowledged. Pending or
unconfirmed ordering and deletion block dragging; partial failure retains the
existing explicit Refresh recovery. Scope changes, list replacement, Escape,
drag end, blur and unmount retire local captures. Foreign payloads cannot supply
conversation IDs. Dragging preserves selection, keyed rows, draft, transcript,
URL and an active response. Shared catalogs and full T29 parity remain open.

## A2UI surfaces

`@threadplane/react/a2ui` renders one A2UI surface. Accumulate wire
messages with `createA2uiSurfaces()` from `@threadplane/content/a2ui`, then pass
a published surface to `A2uiSurface`. Import the stylesheet explicitly.

This entry needs `@threadplane/a2ui` installed. It is an optional peer of
`@threadplane/content`, so applications that never import
`@threadplane/react/a2ui` do not need it; one that does and leaves it out fails
to type-check.

```tsx
import { A2uiSurface } from '@threadplane/react/a2ui';
import '@threadplane/react/a2ui/styles.css';
import type { A2uiSurfacesSnapshot } from '@threadplane/content/a2ui';

export function Surfaces({ snapshot }: { readonly snapshot: A2uiSurfacesSnapshot }) {
  return snapshot.surfaces.map((surface) => (
    <A2uiSurface key={surface.surfaceId} surface={surface} />
  ));
}
```

`a2uiBasicCatalog()` returns `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`,
`Row`, `Column`, `List`, `Card`, `Divider`, `Tabs`, `Modal`, `TextField`,
`CheckBox`, `ChoicePicker`, `DateTimeInput`, `Slider` and `Button`. Spread it into your own registry and pass that as
`catalog` to add or replace components; keep the registry stable. Literal props
pass through and `{ path }` props read the surface data model, so a new snapshot
updates bound text. A component the catalog lacks keeps its children and renders
no control.

### Editable surfaces

Your application owns the store; the surface writes edits into it. Pass the
store as `surfaces` and keep passing its current snapshot:

```tsx
import { useSyncExternalStore } from 'react';
import { A2uiSurface } from '@threadplane/react/a2ui';
import type { A2uiSurfaces } from '@threadplane/content/a2ui';

export function Surfaces({ surfaces }: { readonly surfaces: A2uiSurfaces }) {
  const snapshot = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot);
  return snapshot.surfaces.map((surface) => (
    <A2uiSurface key={surface.surfaceId} surface={surface} surfaces={surfaces} />
  ));
}
```

Each keystroke, toggle, choice, date change or slider movement calls
`surfaces.setValue(surfaceId, path, value)` for the path the control's `value`
is bound to. The store publishes a new snapshot, so every component bound to
that path updates. The edit is local: nothing is sent to an agent. Because the
store holds the edit, it survives the surface unmounting, and it lasts as long
as the store you created. An agent `updateDataModel` applied later replaces the
value at its path, including one the user edited.

`ChoicePicker` writes its whole selection as a string list in option order,
with one item when only one choice is allowed. Its filter is local and never
changes the selection. `DateTimeInput` writes the browser input's own value,
which is local and carries no zone: `YYYY-MM-DD`, `HH:mm` or
`YYYY-MM-DDTHH:mm`. It shows a zone-less ISO value by its digits and a value
with a zone in the viewer's local time.

Without `surfaces` the surface is read-only: text fields and date inputs are
read-only and checkboxes, choices and sliders are disabled. A control whose `value` is a literal, not a
`{ path }`, is fixed in the same way. The surface takes no edited values back as
props and reports no per-edit event; read the store's snapshot when you need the
current data model. Create the store once per conversation or message, outside
render, and dispose it when that lifetime ends.

### Actions

Pass `onAction` to receive a Button's event action. The surface builds the
message when the Button is pressed and sends nothing itself:

```tsx
<A2uiSurface
  surface={surface}
  surfaces={surfaces}
  onAction={(message) => sendToAgent(message)}
/>
```

The message is `{ version: 'v0.9', action: { name, surfaceId,
sourceComponentId, timestamp, context, label? }, metadata? }`. Every `{ path }`
in the action's context is read from the surface's data model at the moment of
the press, so it includes the user's edits. `label` is the Button's literal
text. When the surface was created with `sendDataModel: true`, `metadata`
carries the whole current data model as `a2uiClientDataModel`. Transport,
retries and what the conversation shows are your application's decisions.
`createA2uiActionMessage(surface, componentId)` from
`@threadplane/content/a2ui` builds the same message outside React.

A Button is disabled when there is no `onAction`, when it has no event action,
or when its `disabled` prop is true. A Button used as a `Modal` trigger opens
the modal and needs no action. Validation checks do not gate an action yet, and
a `functionCall` action is not run.

A component of your own can write the same way with `useA2uiSurfaceWriter()`,
which returns `{ editable, write(path, value) }`; take the path from the view's
`bindings`.

Media loads only from relative, `http(s)` and `blob` URLs and from `data:` URLs
of the element's own kind; any other URL renders nothing. `Video` and
`AudioPlayer` use the browser's controls and never start by themselves. A named
`Icon` is a Material Symbols ligature, so load that font in your application; an
`Icon` given `{ svgPath }` needs no font.

`Tabs` and `Modal` keep their own state while the surface stays mounted and send
nothing to the agent. `Tabs` renders only the selected tab's content, so content
in another tab is unmounted; arrow keys, Home and End move and select. `Modal`
shows its content in a native modal dialog named by its trigger; Escape, its
Close button and a press on the backdrop dismiss it. The Close label is English.

`ChoicePicker`, `DateTimeInput`, validation checks, `functionCall` actions,
function-call props, child templates and surface themes are not handled yet.
