# Threadplane chat smoke checklist

Scope: validates the **published** `@threadplane/*` packages render and behave
correctly in a fresh consumer. Run after any release or whenever
changes land in libs/chat, libs/langgraph, libs/render, libs/ag-ui.

## Pre-flight

- [ ] Node >=22.22.3 and exactly npm 11.6.0 for installation; run the generator with `npm exec --yes --package=npm@11.6.0 -- node examples/chat/smoke/cli.mjs` to select npm for this command.

- [ ] `OPENAI_API_KEY` present in the repository root `.env`
- [ ] `nx run examples-chat-python:serve` running on :2024 — `curl localhost:2024/ok` returns `{"ok":true}`
- [ ] Smoke consumer started — page loads at :4200
- [ ] No console errors on initial load (telemetry DNS failure OK)
- [ ] No 4xx/5xx in the network tab on initial load

## Initial render (welcome state)

- [ ] Default route redirects to `/embed`
- [ ] Welcome heading renders ("How can I help?")
- [ ] All declared welcome suggestion buttons render with their labels
- [ ] Control palette renders top-right, fully expanded by default
- [ ] Palette mode segmented control highlights "Embed"
- [ ] Palette model dropdown shows the default model
- [ ] Palette debug toggle shows "off"
- [ ] Send button disabled when input is empty

## Send & receive (basic streaming)

- [ ] Type any prompt, click Send — input clears, user message renders immediately
- [ ] Typing indicator appears between send and first token
- [ ] Tokens stream visibly into the assistant bubble (not all-at-once)
- [ ] Final message stays after stream completes
- [ ] Auto-scroll keeps the latest content visible during streaming
- [ ] Send button re-enables after stream completes

## Stop mid-stream

- [ ] Send a long prompt
- [ ] Mid-stream, Send button has flipped to "Stop generating"
- [ ] Click stop — stream halts, partial response remains rendered
- [ ] No console errors; agent returns to idle; Send button returns

## Markdown surfaces (the partial-markdown render path)

Send a prompt that asks for each of the following. Check that each
renders correctly both during streaming and after completion.

> **Known regressions** documented in the chat 0.0.20 partial-markdown
> swap: tables and task lists may not match the previous (marked-based)
> rendering exactly. If a check fails, file an issue against
> `libs/chat` rather than skipping — the smoke checklist is the
> canonical "what should work" list.

- [ ] **Headings** — `# H1`, `## H2`, `### H3` all render at distinct sizes
- [ ] **Paragraphs** with **bold**, *italic*, and `inline code`
- [ ] **Bullet lists** including nested (2+ levels)
- [ ] **Ordered lists** with correct numbering
- [ ] **Task lists** — `- [ ]` (unchecked) and `- [x]` (checked) render as checkboxes
- [ ] **Fenced code blocks** with language hint — preserved as `<pre><code>`
- [ ] **Tables** with header row + 2+ data rows — column alignment preserved
- [ ] **Blockquotes** — visually distinct
- [ ] **Links** — clickable, open in new tab
- [ ] **Horizontal rules** — render as a line
- [ ] No raw HTML escapes through (e.g. `<script>` displayed as text, not executed)

### Streaming-specific markdown checks

- [ ] Mid-stream, an incomplete fenced code block (open ``` no close) renders
      as a code block (does not flash to plain text)
- [ ] Mid-stream, an incomplete table row does not corrupt the table
- [ ] No visible flicker / layout shift as tokens arrive
- [ ] Long response keeps autoscrolling to bottom

## Regenerate

- [ ] After a response completes, hover the assistant message — actions row appears
- [ ] "Regenerate response" button is present and enabled
- [ ] Click regenerate — old assistant message is replaced (not appended)
- [ ] Typing indicator appears, then tokens stream into the new assistant slot
- [ ] After completion, exactly **1 user / 1 assistant** in the conversation
- [ ] Server-side state matches: `curl localhost:2024/threads/<id>/state`
      returns 2 messages with `next: []`
- [ ] Repeated regenerate (3 times in a row) keeps state at 1u/1a each time

## Cross-mode persistence

- [ ] In `/embed`, send a message
- [ ] Navigate to `/popup` — same conversation visible
- [ ] Open the popup — message history is intact
- [ ] Navigate to `/sidebar` — same conversation
- [ ] Open the sidebar — message history is intact
- [ ] Send from `/sidebar`, navigate back to `/embed` — new message present

## Mode switching (route + URL)

- [ ] `/embed` renders `<chat>` inline, full viewport
- [ ] `/popup` renders a launcher button; clicking opens a floating window
      with `role="dialog"`, contains the chat
- [ ] `/sidebar` renders a launcher; clicking slides in a panel with
      `role="complementary"`
- [ ] Browser back/forward navigates between modes correctly
- [ ] Direct deep-link to `/popup` works (no flash of `/embed` first)
- [ ] Unknown route (`/foo`) redirects to `/embed`
- [ ] Closing the popup does not navigate; URL stays `/popup`
- [ ] Same for sidebar close

## Model picker

- [ ] Palette dropdown lists the configured models
- [ ] Selecting a different model — palette text updates immediately
- [ ] Send a message — backend log shows the new model name
      (or check `/threads/<id>/state` `values.model` field)
- [ ] Selection persists across page reload
- [ ] Selection persists across mode switches

## chat-debug devtools

- [ ] Sidenav footer shows a labelled `Debug` button in expanded/drawer mode
- [ ] Collapsed sidenav shows the debug status dot without the text label
- [ ] Debug dot pulses while the agent is streaming
- [ ] Click the footer debug button — debug panel opens
- [ ] Panel shows current agent state and timeline when checkpoint history is available
- [ ] Panel updates live as messages stream
- [ ] Click the close affordance — panel unmounts; launcher remains

### Coexistence with chat-sidebar

- [ ] Switch to Sidebar mode via the demo toolbar — debug panel auto-redocks to the bottom (was: right)
- [ ] Open the sidebar launcher (bottom-right) — slides in over the demo bg; debug bottom panel stays visible at the LEFT of the sidebar
- [ ] Manually click the right-dock icon — debug moves to the right edge of the demo bg (NOT under the sidebar); user override sticks for the rest of the session

- [ ] Open/closed state persists across page reload
- [ ] No `console.error` while toggling
- [ ] DOM has no `<chat-debug>` element when closed

## Demo toolbar

- [ ] Top toolbar controls mode, model, effort, Gen UI mode, theme, and new conversation
- [ ] Toolbar remains demo-owned and does not appear inside the debug panel
- [ ] Toolbar stays reachable in embed, popup, and sidebar modes

## Color scheme (Light / Dark)

- [ ] Palette → APPEARANCE section shows a `Light` / `Dark` segmented control above the existing `Theme` dropdown
- [ ] Default is `Dark` on first load
- [ ] Toggle to `Light` — `<html>` flips to `data-color-scheme="light"` and `data-threadplane-chat-theme="light"`
- [ ] Page background flips to white; chat composition + sidenav backgrounds flip to light
- [ ] A2UI surface text colors invert correctly (no white-on-white or black-on-black)
- [ ] Toggle back to `Dark` — all of the above restore
- [ ] When A2UI theme dropdown is on `default-dark` or `default-light`, it auto-syncs with the color scheme toggle
- [ ] When A2UI theme is on a `material-*` preset, color scheme toggle does NOT change the A2UI theme (user override wins)
- [ ] Selection persists across reload (`localStorage.threadplane-chat-demo:palette.colorScheme`)
- [ ] No FOUC on initial load — inline `<head>` script reads the persisted value before bootstrap
- [ ] No `console.error` on toggle

## Keyboard & accessibility

- [ ] Tab order reaches: input, send button, suggestions (when shown),
      palette controls, message actions (when hovered/focused)
- [ ] Enter in input — sends message
- [ ] Shift+Enter in input — inserts newline (does not send)
- [ ] Escape closes popup or sidebar (when open)
- [ ] Send button has accessible name "Send message"
- [ ] Stop button (mid-stream) has accessible name "Stop generating"
- [ ] Regenerate button has accessible name "Regenerate response"
- [ ] Copy button has accessible name "Copy to clipboard" → "Copied"
- [ ] Popup window has `role="dialog"`
- [ ] Sidebar panel has `role="complementary"` and `aria-hidden` toggles correctly

## Error handling

- [ ] Stop the Python server (`Ctrl+C` on :2024) and try sending — UI
      surfaces an error in `<chat-error>`, does not crash
- [ ] Restart Python server and send again — recovers without reload
- [ ] Send with `OPENAI_API_KEY` invalid — error surfaces; no infinite spinner

## Lifecycle

- [ ] Reload the page mid-conversation — agent reconnects, history reappears
      from server state (NOT fresh empty state)
- [ ] Click "New conversation" in palette — welcome state reappears, prior
      conversation is no longer attached (next submit creates a new thread server-side)
- [ ] Browser back navigates routes correctly
- [ ] Selecting a welcome suggestion sends and clears the welcome state

## Browser hygiene

- [ ] No `console.error` after smoke run completes
- [ ] No `Uncaught` promise rejections
- [ ] No memory leak across 10 mode-switch cycles (DevTools heap snapshot
      stable, no detached `<chat-message>` nodes)
- [ ] Network tab — no failed `localhost:2024` requests except the
      well-known `runs/stream` `ERR_ABORTED` (SSE terminus, expected)

## Visual polish

- [ ] Chat content readable at default zoom
- [ ] Layout responsive: viewport at 1440px, 1024px, 768px, 480px — no
      horizontal overflow, palette stays in viewport
- [ ] Markdown styles match the rest of the app's typography
- [ ] No flash of unstyled content on initial load

## Capture

- [ ] If anything failed, capture: `SMOKE_RUN.md` (auto-generated by CLI),
      console logs (last 100 lines), network tab HAR export, screenshot.

---

# Phase 2+ sections (intentionally empty in Phase 1)

## Reasoning blocks

- [ ] Palette "Effort" dropdown lists 5 options
      (model default / minimal (fast) / low / medium / high (visible reasoning))
- [ ] Default value is `model default` on first load, and the submitted
      state carries `reasoning_effort: null` (the model's own default applies)
- [ ] Effort selection persists across reload
- [ ] With model = gpt-5-mini and effort = high, send the puzzle prompt
      ("Solve a multi-step puzzle (try Effort = high)" welcome suggestion):
  - [ ] `<chat-reasoning>` pill appears with "Thinking…" + pulsing dot during streaming
  - [ ] Reasoning body auto-expands during streaming (markdown rendered)
  - [ ] After completion, pill collapses to "Thought for {duration}"
  - [ ] Click pill — body expands; click again — collapses
- [ ] With effort = minimal, same prompt — pill appears briefly or not at all
      (first-token latency low)
- [ ] Switch effort mid-conversation, send again — new message reflects new effort
- [ ] Cross-mode: send in /embed with effort=high, navigate to /popup,
      open popup — reasoning pill on the prior message still renders
- [ ] Server state shows `values.reasoning_effort` matches palette selection
      (`curl localhost:2024/threads/<id>/state`)

## Tool calls

- [ ] Click "What are Angular signals? (search + cite sources)" welcome suggestion
- [ ] During streaming: a tool-call card appears for `search_documents` with a running pill
- [ ] After tool completes: card collapses to "complete" pill
- [ ] Click the card — args + result panels expand
- [ ] AI response references documents inline (e.g. "Signals are... [1]")
- [ ] Tool call card name (`.tcc__name`) is rendered in `--tplane-chat-text-muted` color and `font-size-sm` (NOT full-brightness text)
- [ ] Tool call status pill (`.tcc__pill`) uses muted monochrome (`--tplane-chat-text-muted`) regardless of status — NO saturated green/red for complete/error states
- [ ] `<chat-tool-calls>` host has `margin-bottom >= 16px` so the next sibling (A2UI surface or markdown) has clear breathing room

## Interrupts / human-in-the-loop

- [ ] Click "Demo: ask for approval before a sensitive action" welcome suggestion
- [ ] AI begins planning, then calls `request_approval` tool — graph pauses
- [ ] Interrupt panel renders ONCE — no duplicate inline banner inside the message stream
- [ ] Panel title reads "Agent paused"
- [ ] Panel body shows the human-readable `reason` text (NOT the raw JSON envelope like `{"type":"approval_request",...}`)
- [ ] Panel respects color scheme: in light mode the bg is light + text dark; in dark mode bg dark + text light
- [ ] Button hierarchy is visible: Accept primary (filled), Edit/Respond secondary (bordered), Ignore tertiary (muted text only)
- [ ] Panel docks above the chat input without overlapping it, even when the subagents strip is also present
- [ ] Click Accept — graph resumes with `'approved'`; AI proceeds with the plan
- [ ] (New conversation, click suggestion again) — Click Edit, type a custom response in the prompt — graph resumes with the typed text
- [ ] (New conversation, click suggestion again) — Click Ignore — graph resumes with `'denied'`; AI acknowledges and stops
- [ ] During pause: server state shows the interrupt — `curl localhost:2024/threads/<id>/state` reports `next` includes the interrupted node and a pending interrupt value
- [ ] On thread reload while paused at an interrupt: reload the page — interrupt panel re-appears with the same reason text (hydrated from checkpoint history)

## Citations

- [ ] Sources panel ("Sources") renders below the assistant message
- [ ] 3-5 citations listed with title, url, snippet preview
- [ ] Inline `[1]`, `[2]` markers in the message body link to the corresponding source
- [ ] Click a source title — opens the URL in a new tab
- [ ] Server-side: `curl localhost:2024/threads/<id>/state` shows the AI message has `additional_kwargs.citations` with the list

## Generative UI / A2UI surfaces

### Gen UI mode dropdown

- [ ] Palette "Gen UI" dropdown lists 2 options: `A2UI` and `json-render`
- [ ] Default value is `A2UI` on first load
- [ ] Selection persists across reload and mode switches
- [ ] Server-side: `curl localhost:2024/threads/<id>/state` shows `values.gen_ui_mode` matches the palette selection

### Dynamic dispatch — A2UI mode

- [ ] With Gen UI = `A2UI`, click any GenUI welcome suggestion (e.g. "Demo: render a feedback form")
- [ ] **Single bubble** — exactly ONE assistant bubble per GenUI turn (no skeleton bubble followed by a separate surface bubble)
- [ ] Parent LLM emits a tool_call to `render_a2ui_surface` (parent emits envelopes directly as typed args — there is no sub-LLM hop)
- [ ] Final assistant AI message carries BOTH `tool_calls` AND `---a2ui_JSON---\n`-prefixed content (in-place replacement of the tool-call AI)
- [ ] `<a2ui-surface>` renders inside the assistant bubble matching the requested form
- [ ] Surface is interactive: fields accept input, buttons are clickable
- [ ] Click Submit → chat round-trips an `A2uiActionMessage` as a new user submit
- [ ] AI replies conversationally referencing the submitted data
- [ ] No `console.error` during render or submit cycle

### Progressive A2UI streaming (per-component fallback transition)

- [ ] DevTools Network → trigger any A2UI GenUI prompt; the `/runs/stream` SSE response contains `event: custom` frames carrying `a2ui-partial` payloads (`{name: 'a2ui-partial', data: {tool_call_id, args_so_far}}`)
- [ ] At least several `a2ui-partial` frames stream as the parent LLM emits tool-call argument tokens (not all-at-once)
- [ ] During streaming: `<a2ui-surface>` mounts before all `updateDataModel` envelopes arrive — components show `<render-default-fallback>` (shimmer card with "Building UI…" label) until their bound state populates
- [ ] As each `updateDataModel` envelope arrives, exactly one component flips from fallback → real
- [ ] Monotonic latch: once a component renders real, a later prop becoming undefined does NOT revert it to fallback
- [ ] After completion: zero `<render-default-fallback>` elements; all components rendered with their final props

### Dynamic dispatch — json-render mode

- [ ] Switch Gen UI dropdown to `json-render`
- [ ] Click any GenUI welcome suggestion (e.g. "Demo: render a settings card")
- [ ] Parent AI emits a tool_call to `generate_json_render_spec`
- [ ] Sub-LLM generates a json-render Spec (`{root, elements, state}`); `emit_generated_surface` strips markdown fencing and emits a bare JSON AIMessage
- [ ] Final assistant bubble renders the json-render surface (this mode stays batch — no progressive streaming)
- [ ] No console errors during the render cycle

### Server-side wire format

- [ ] In A2UI mode: the final AI message content starts with `---a2ui_JSON---\n` followed by JSONL (one envelope per line, each with `"version":"v0.9"`); contains at minimum `createSurface` and `updateComponents` envelopes; envelopes are reordered so `createSurface` comes first regardless of LLM emission order (synthesized if the model forgot it)
- [ ] The same AI message carries `tool_calls` set (single-bubble invariant)
- [ ] In json-render mode: final AI message content is a bare JSON object starting with `{`
- [ ] `curl localhost:2024/threads/<id>/state` confirms the above for both modes

### A2UI catalog coverage

The 18 catalog components must render correctly when the LLM-generated surface includes them. After clicking each demo suggestion below, verify the rendered surface contains the listed component types and that each looks visually correct (no overflow, alignment intact, text legible, interactive controls functional).

- [ ] "Demo: render a feedback form" — `Card` + `Column` + `Text` + `TextField` + (`ChoicePicker` or `Slider`) + `Button`
- [ ] "Demo: render a settings card" — `Card` + `Column` + `Text` + `ChoicePicker` + `CheckBox` + `Button`
- [ ] "Demo: render a poll" — `Card` + `Column` + `Text` + `ChoicePicker` + `Button`
- [ ] "Demo: render a contact form" — `Card` + `Column` + `Text` + `TextField` + `Button`
- [ ] "Demo: render a media-rich product card" — `Image` + `Tabs` + `Row` + `Icon` + `List` + `Button`
- [ ] "Demo: render a booking surface with modal" — `DateTimeInput` + `Divider` + `Row` + `Card` + `TextField` + `Modal`

Components NOT yet exercised by the demo (deferred to future media-focused suggestions): `Video`, `AudioPlayer`.

## Subagents

- [ ] Click "Demo: dispatch a research subagent" welcome suggestion
- [ ] Parent AI begins planning, then emits a tool_call to `research` — graph dispatches the subagent
- [ ] `<chat-subagents>` panel appears above the chat input with one running subagent card
- [ ] Card surfaces the subagent's status (running) and the tool-call args (topic) while the child runs
- [ ] Once the subagent completes, the active filter hides its card; parent AI emits its final summary message in the chat
- [ ] Server-side: `curl localhost:2024/threads/<id>/state` shows tool_calls included `{ "name": "research", ... }` and the subgraph's messages were emitted under a `tools:<id>` namespace
- [ ] No console errors during the subagent run; no flicker of the subagents panel during streaming

## Time travel / timeline

- [ ] Palette shows "Timeline off" toggle button (next to "Debug off")
- [ ] Click "Timeline off" — button label changes to "Timeline on"; timeline panel appears on the right side of the screen
- [ ] Timeline panel shows `<chat-timeline-slider>` with a "Timeline" heading and checkpoint count
- [ ] Click "Timeline on" — panel unmounts; no console errors; DOM has no `<chat-timeline-slider>` element
- [ ] Timeline open/closed state persists across page reload (stored under `timeline` key in localStorage)
- [ ] Send several messages — each creates a checkpoint listed in the slider (count increments)
- [ ] Each checkpoint entry shows a numbered index pill, a label ("Step N" or step name), and the checkpoint id
- [ ] Hovering a checkpoint entry highlights it (subtle background)
- [ ] Click "Replay" on a checkpoint — agent re-runs from that point with no new input; message list reflects the replayed history
- [ ] After replay: server-side `curl localhost:2024/threads/<id>/state` shows the correct checkpoint was used
- [ ] Click "Fork" on a checkpoint — a new thread is created server-side; agent switches to the new thread and re-runs from that checkpoint
- [ ] After fork: `threadId` in localStorage has changed to the new thread id
- [ ] After fork: the conversation reflects the forked state, not the original thread's later messages
- [ ] Timeline panel scrolls independently when the checkpoint list is taller than the panel
- [ ] Timeline panel does not obscure the chat input or send button at any supported viewport width

## Sidenav (thread management)

- [ ] Left sidenav renders by default as a semantic `<nav>` with `position: fixed`
- [ ] Sidenav is `position: fixed` at desktop widths (>= 1024px) — confirmed via `getComputedStyle`
- [ ] Sidenav header has a topbar containing two icon-only buttons (Create on the left, Collapse/Expand chevron on the right). Search is a separate full-width row below the topbar.
- [ ] Sidenav has two sections: **Active** and **Archived**
- [ ] Archived section collapses/expands
- [ ] Create (+) icon in topbar calls `POST /threads`, switches the agent, resets the chat area to welcome state
- [ ] Threads render with their server-derived title (set from the first user message) — NOT a "Thread XXXX" id placeholder
- [ ] Active row that matches the current thread is visually distinguished (`data-active` attribute)
- [ ] Click a different active row — chat area reloads the selected thread's messages
- [ ] Last active thread id persists across reload (localStorage)
- [ ] Sidenav refreshes from backend on thread switch so newly-created threads appear
- [ ] Collapse handle shrinks the sidenav to icon strip; expand restores; state persists
- [ ] No `console.error` on any sidenav interaction

## Cmd+K history search

- [ ] Press **Cmd+K** (Ctrl+K on Linux/Windows) — search palette overlays the viewport
- [ ] Magnifier icon in the sidenav header also opens the palette
- [ ] Empty-query state: helpful placeholder text, no result list
- [ ] Type a query — fuzzy matches against active AND archived thread titles
- [ ] Archived matches render with an "Archived" subtitle line
- [ ] ↑/↓ arrows move focus through results; Enter activates the focused result
- [ ] Selecting a result switches to that thread (uses `applyArchived` reactivation flow if archived)
- [ ] **Esc** closes the palette; clicking outside closes the palette
- [ ] No `console.error` on open/search/select/close

## Per-row thread actions (kebab menu)

- [ ] Hover an active-section row — kebab (⋯) fades in on the right
- [ ] Active row kebab menu order: **Rename**, **Pin**, **Archive**, **Delete**
- [ ] **Rename** opens an inline edit affordance; typing + Enter renames the thread; Escape cancels
- [ ] Renamed title persists across reload (server-side `metadata.title` PATCH on `/threads/{id}`)
- [ ] **Pin** — row jumps to the top of the active list on refresh; pin icon appears left of the title
- [ ] Pinned row kebab menu order: **Rename**, **Unpin**, **Archive**, **Delete** (no "Pin")
- [ ] **Unpin** — pin icon disappears; row returns to chronological order on refresh
- [ ] Pinned state persists across reload (PATCH `metadata.pinned`)
- [ ] Pinned rows show a drag-grip handle on the left edge on hover (`aria-label="Drag to reorder"`)
- [ ] Drag a pinned thread — reorders within the pinned group; non-pinned threads unaffected
- [ ] Pinned row kebab also includes **Move up** and **Move down** items (above Archive/Delete), enabled only when applicable (e.g. Move up disabled on the topmost pinned row)
- [ ] Pin reorder persists across reload via `metadata.pinnedOrder` (verify backend key)
- [ ] **Archive** — row moves out of Active and into Archived; chat area switches to a fresh state if archived thread was active
- [ ] **Delete** — confirmation prompt fires; on confirm, row removed from list and thread gone server-side (DELETE `/threads/{id}`); cancellation leaves thread intact
- [ ] Archived row kebab menu order: **Unarchive**, **Delete** (no Pin/Unpin — pinning is active-mode only)
- [ ] **Unarchive** — row returns to Active section
- [ ] DevTools network: each action sends the expected PATCH/DELETE with proper payload; no console errors

## Thread titles

- [ ] First user message in a new thread triggers a server-side title write (LLM-generated 3-5 word summary from the message text)
- [ ] Title appears in the sidenav row label after the run completes (refresh-driven)
- [ ] Title is idempotent — a second message into the same thread does NOT overwrite the title
- [ ] Manually renamed titles (via kebab → Rename) take precedence and are not overwritten by subsequent messages
- [ ] `curl localhost:2024/threads/<id>` shows the title under `metadata.title`

## Inline checkpoint markers

- [ ] During a multi-step run, checkpoint markers render inline within the chat between messages (small horizontal rule with a label)
- [ ] Each marker shows the step label and checkpoint id (or a short identifier)
- [ ] Hovering a marker highlights it consistently with the timeline-panel checkpoint entry
- [ ] Markers do not break message spacing or autoscroll
- [ ] Hovering a checkpoint marker dot shows the "Rewind / Fork" action pill **immediately adjacent** to the dot (not floating ~250px below) — confirms the marker host's `position: relative` regression has not returned

## Responsive sidenav

- [ ] At viewport ≥ 1024px: sidenav stays in `position: fixed` expanded state by default
- [ ] At viewport < 1024px: sidenav auto-collapses to icon strip (or overlay) so the chat area stays usable
- [ ] At viewport ≤ 768px: chat input + send remain accessible; sidenav does not push the chat horizontally
- [ ] No horizontal scrollbar at any tested viewport
- [ ] Toggling collapse manually overrides the responsive default until the next breakpoint crossing

## Sidenav collapsed mode

- [ ] Click the chevron in the sidenav topbar (or press Cmd+B) to collapse
- [ ] Collapsed width is ~56px
- [ ] Topbar icons stack vertically in collapsed mode: `+` (Create) on top, chevron (Expand) below
- [ ] Search icon remains in its row below the topbar
- [ ] Thread rows in collapsed mode show a circular initial avatar (first letter of title, uppercase, surrogate-pair-safe)
- [ ] Thread row labels, kebab, grip handle, and timestamps are hidden in collapsed mode
- [ ] Hovering a thread row in collapsed mode reveals the full title via native browser tooltip (`[title]` attribute)
- [ ] Right-click any thread row (collapsed OR expanded) — opens the same overflow menu anchored to the cursor; OS native context menu is suppressed via `event.preventDefault()`
- [ ] Click the chevron again (or Cmd+B) — restores expanded mode
- [ ] Persists across reload (`localStorage.threadplane-chat-demo:palette.sidenavMode = 'collapsed'`)

## Projects

- [ ] Sidenav renders a **PROJECTS** section between Search and RECENT
- [ ] "+ New project" affordance visible at the top of the section
- [ ] Clicking "+ New project" replaces the affordance with an inline input ("New project name", autofocused)
- [ ] Typing a name + Enter creates the project, persists to `localStorage` (`threadplane-chat-demo:projects`), and **auto-selects** it
- [ ] Escape (or blur with empty value) cancels the inline create
- [ ] Selecting a project filters the RECENT list to threads whose `metadata.projectId` matches
- [ ] Selecting an empty project leaves RECENT empty; ARCHIVED section unaffected
- [ ] Clicking the active project row again deselects it (RECENT returns to unfiltered)
- [ ] Active project row is visually distinguished (`data-active`)
- [ ] Hover a project row — kebab fades in
- [ ] Kebab menu order: **Rename**, **Delete** (no Pin/Unpin/Archive — projects are a different surface)
- [ ] **Rename** → inline edit input on the row; Enter commits, Escape cancels; persists across reload
- [ ] **Delete** → confirmation dialog; on confirm, project removed; member threads remain (projectId becomes orphaned and threads fall back to default RECENT)
- [ ] Project state (list + selected id) persists across reload

## Move thread to project

- [ ] With at least one project created, open a thread row's kebab in active mode
- [ ] Menu order: **Rename**, **Pin/Unpin**, **Move to project**, **Archive**, **Delete**
- [ ] Clicking "Move to project" opens a second overflow-menu (submenu) anchored to the same kebab
- [ ] Submenu lists `[No project, ...projects]` with the thread's current projectId highlighted
- [ ] Selecting a project moves the thread (PATCH `metadata.projectId`); the thread disappears from the current view (optimistic-hide)
- [ ] After the next sidenav refresh, the thread appears under the new project's filtered list
- [ ] Selecting "No project" clears the thread's projectId; thread returns to default RECENT
- [ ] Move action is idempotent (selecting the current project is a no-op)
- [ ] No `console.error` during project create / rename / delete / move
