# @threadplane/react

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
delimited text; citations are numbered or unresolved text markers. Missing,
blocked and failed images show an accessible alt-text fallback. Destination
classification is the fixed [`content/markdown` policy](../content/README.md),
including exclusion of data images. The root binding stays headless; rich math,
syntax highlighting, citation overlays, custom node registries, legacy migration,
SSR and hydration remain outside this private feature.

## Chat

`Citations` presents an explicit readonly `Citation[]` from `@threadplane/core`
as a named Sources section. Empty input renders nothing. It preserves supplied
order, index, title, snippet and source-type text; IDs must be unique. Optional
`label` and `className` customize the section. Same-ID updates preserve mounted
source items. An absent title falls back to the supplied URL or `Source <index>`;
intentionally empty fields remain empty.

```tsx
import { Citations } from '@threadplane/react/chat';

<Citations citations={message.citations ?? []} />;
```

Allowed URLs use the existing content/Markdown link policy, with a native new-tab
link and `noopener noreferrer`. Missing or blocked URLs display text. The view
does not fetch icons, previews or metadata, parse snippets, merge Markdown
sidecars, infer dates/types, subscribe or dispose anything. Default MessageList
shows supplied sources after assistant answers; custom row rendering selects its
own presentation. Styles are opt-in through `/chat/styles.css`. This bounded
Sources view does not provide the legacy citation overlays or full citation parity.

`MessageActions` renders a named group of explicitly authored native buttons.
Supply readonly actions with unique `id`, string `label`, argumentless `onSelect`
and optional `disabled`. Root `disabled`, `label` and `className` are optional;
empty actions render nothing. The app owns clipboard writes, async feedback,
ratings and regeneration commands. Mounting or updating the view invokes no action.
Callbacks may return promises; the app must handle their completion and errors.

```tsx
import { MessageActions } from '@threadplane/react/chat';

<MessageActions
  actions={[{ id: 'copy', label: 'Copy answer', onSelect: () => void copyAnswer() }]}
  disabled={copyPending}
/>;
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
Chat never disposes app-passed content. The stylesheet is opt-in and scoped to `.tp-chat*`
classes, with `--tp-chat-*` custom properties that fall back to `--ds-*` tokens.
Compose `MessageList` and `ChatInput` directly when your app owns selection or
rendering.

`MessageList` infers the concrete row type from `rows`, including authored fields
and typed tool contracts, and passes it to `renderMessage`. Keep that callback
stable so unchanged rows stay memoized. Give the list a bounded height and
overflow scrolling in app CSS; it follows row updates while at the bottom and
preserves the reader's position when scrolled up. Key it by conversation ID when
a new selection should start at the bottom. Same-ID updates preserve scroll state.
Where `ResizeObserver` is available, the list also follows height changes inside
unchanged rows, including image loads and disclosure expansion, while pinned.
The same observer follows scroll-region size changes, including a height-only
window resize, while pinned.
Reading above the bottom preserves position. The observer disconnects on unmount;
without it, row-update following remains available. The list uses one unstyled
content wrapper inside its existing scroll region.

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
uses the existing action slot; project actions, drag reordering, live timestamp refresh remain future work. This is a bounded private T29 slice.

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
project actions, drag reordering and full T29/T30 parity remain open.

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
remains selection-only. Typeahead, further lifecycle/project commands
and full parity remain open.

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
backend search, search dialogs, other global shortcuts, debug ownership and full
Angular composition parity remain open under T30. The native Search loaded
conversations action reveals navigation and focuses its existing loaded-title
filter once per explicit request, without adding backend search or commands.

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
Fork, replay, diff and full T29 parity remain outside this first private slice.

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
outside-pointer close retain outside focus; user-close restores the launcher only
while focus remains owned by that panel.

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
New conversations remain unassigned, and pinned reordering still spans all loaded
pins, including other projects. Deletion, association writes/move-to-project and
full T29 parity remain open. See the naming slice below for persistence behavior.

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
Catalog-only projects can be selected with an empty conversation view. New
conversations remain unassigned. These are local labels, not a shared server catalog.

Writes reread and validate the current catalog and publish only after persistence
succeeds. Malformed/unsupported saved data is never replaced; unavailable storage
and write failures keep the draft and target, expose Retry, and block submission
until recovery. Retry reloads without committing. Storage events (including clear)
refresh names without broadening a retained filter or replacing an active draft.
This uses browser localStorage's last-writer-wins behavior, not atomic multi-tab
transactions. No cross-device sharing or backend project commands are introduced.
Project selection, naming and persistence preserve the selected conversation,
transcript, composer draft and running session without extra network calls.
Project deletion, association writes/move-to-project and full T29 parity remain open.

Conversation menus also retain their opening through a queued scroll notification
from an anchor ancestor whose vertical/horizontal offsets already settled before
opening. Actual later ancestor movement, document/unrelated scroll notifications,
outside input and resize still dismiss the menu. The shorter native rail browser
proof covers unchanged queued notification, genuine scrolling, reopening and the
retained pin/unpin flow without retries or added timeouts.
