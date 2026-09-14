# @threadplane/chat

The chat surface of [Threadplane](https://github.com/cacheplane/threadplane), the open-source thread-plane for agents. Headless primitives plus opinionated compositions read a runtime-neutral `Agent` contract, so the UI is built once and runs over LangGraph or AG-UI without changes. Angular 20–22, on Signals and DI.

<p>
  <a href="https://www.npmjs.com/package/@threadplane/chat">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Fchat?color=6C8EFF&labelColor=080B14&style=flat-square" />
  </a>
  <img alt="Angular 20 | 21 | 22" src="https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-6C8EFF?labelColor=080B14&style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-6C8EFF?labelColor=080B14&style=flat-square" />
</p>

**MIT-licensed.** Use it in commercial products, internal tools, agency work, and open-source projects without registration or runtime checks.

---

## What it does

- **Full chat surface in one tag.** `<chat [agent]="agent" />` wires up message history, streaming output, typing indicator, input, interrupts, tool calls, subagents, citations, and generative UI — all from a single binding.
- **Layered architecture.** Use the opinionated compositions for fast shipping, drop down to individual primitives (30+) to build custom layouts, or mix both.
- **Runtime-neutral.** Compositions consume an `Agent` contract. The library has no hard dependency on LangGraph, AG-UI, or any other backend — swap or combine adapters without touching your UI.
- **A2UI generative UI.** Agents emit structured surface specs; `<a2ui-surface>` renders them as interactive Angular components with a themeable `--a2ui-*` token system.

---

## Install

```bash
npm install @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked
```

**Peer dependencies:**

```
@angular/core              ^20.0.0 || ^21.0.0 || ^22.0.0
@angular/common            ^20.0.0 || ^21.0.0 || ^22.0.0
@angular/platform-browser  ^20.0.0 || ^21.0.0 || ^22.0.0
@angular/router            ^20.0.0 || ^21.0.0 || ^22.0.0
@threadplane/render        *
@threadplane/a2ui          *
@json-render/core          ^0.16.0
@langchain/core            ^1.1.33
rxjs                       ~7.8.0
marked                     ^15.0.0 || ^16.0.0
zod                        ^3.25.0
katex                      ^0.16.0 || ^0.17.0 (optional)
```

---

## Quick start

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({ apiUrl: '/api/langgraph', assistantId: 'agent' }),
  ],
};
```

```typescript
// my.component.ts
import { Component } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/langgraph';

@Component({
  selector: 'app-root',
  imports: [ChatComponent],
  template: `<chat [agent]="myAgent" />`,
})
export class AppComponent {
  protected readonly myAgent = injectAgent();
}
```

Get the agent from `@threadplane/langgraph` (for LangGraph Platform backends) or `@threadplane/ag-ui` (for AG-UI-compatible backends). See those packages for setup details.

---

## Capabilities

### Compositions

Ready-to-use full-feature layouts:

| Component                     | Selector                 | Description                                     |
| ----------------------------- | ------------------------ | ----------------------------------------------- |
| `ChatComponent`               | `<chat>`                 | Full-page chat layout; primary entry point      |
| `ChatPopupComponent`          | `<chat-popup>`           | Floating popup with a launcher button           |
| `ChatSidebarComponent`        | `<chat-sidebar>`         | Sidebar-docked layout                           |
| `ChatSidenavComponent`        | `<chat-sidenav>`         | Sidenav host with project/thread list panel     |
| `ChatTimelineSliderComponent` | `<chat-timeline-slider>` | Time-travel slider for agent checkpoint history |
| `ChatInterruptPanelComponent` | `<chat-interrupt-panel>` | Full interrupt-handling composition             |
| `ChatApprovalCardComponent`   | `<chat-approval-card>`   | Approval/rejection dialog for HITL flows        |
| `ChatToolCallCardComponent`   | `<chat-tool-call-card>`  | Rich card for a single tool call                |
| `ChatSubagentCardComponent`   | `<chat-subagent-card>`   | Rich card for a subagent delegation             |

### Primitives

30+ standalone components for custom layouts:

`<chat-message-list>`, `<chat-message>`, `<chat-message-actions>`, `<chat-window>`, `<chat-input>`, `<chat-typing-indicator>`, `<chat-tool-calls>`, `<chat-subagents>`, `<chat-citations>`, `<chat-streaming-md>`, `<chat-trace>`, `<chat-reasoning>`, `<chat-interrupt>`, `<chat-error>`, `<chat-scroll-bubble>`, `<chat-launcher-button>`, `<chat-suggestions>`, `<chat-welcome>`, `<chat-select>`, `<chat-thread-list>`, `<chat-project-list>`, `<chat-timeline>`, `<chat-generative-ui>`, `<chat-genui-skeleton>`, `<chat-overflow-menu>`, `<chat-confirm-dialog>`, `<chat-history-search-palette>`, `<chat-sidenav-scrim>`.

Custom content templates for message bubbles, tool call rows, and citation cards use structural directives: `MessageTemplateDirective`, `ChatToolCallTemplateDirective`, and `ChatCitationCardTemplateDirective`.

### Human-in-the-loop (interrupts)

`<chat-interrupt-panel>` surfaces the current `AgentInterrupt` and emits `accept`, `edit`, `respond`, or `ignore` through its `action` output. `<chat-approval-card>` emits `approve`, `cancel`, or `edit` (when enabled) for explicit approval workflows. The caller maps these actions to the backend's resume payload.

```html
<chat-interrupt-panel [agent]="agent" (action)="onAction($event)" />
```

```typescript
import { injectAgent } from '@threadplane/langgraph';
import type { InterruptAction } from '@threadplane/chat';

// Component members; add ChatInterruptPanelComponent to component imports.
readonly agent = injectAgent();

async onAction(action: InterruptAction): Promise<void> {
  if (action === 'accept') {
    await this.agent.submit({ resume: 'confirm' });
  } else if (action === 'ignore') {
    await this.agent.submit({ resume: 'cancel' });
  }
}
```

This handler implements only Accept and Ignore; the panel still renders all four buttons. Use a custom template for a two-button UI. The strings above match the flight demo's backend contract. Other tools may expect `{ approved: boolean }`; a button label does not define a universal resume payload.

### Tool calls and subagents

`<chat-tool-calls>` renders in-progress and completed tool calls. Customize per-call layout with `ChatToolCallTemplateDirective` — the `chatToolCallTemplate` input takes a tool name to match, or `"*"` for all; the template context exposes the `ToolCall` (`$implicit`) and its `status`:

```html
<chat-tool-calls [agent]="agent">
  <ng-template chatToolCallTemplate="*" let-call let-status="status">
    <my-tool-card [call]="call" [status]="status" />
  </ng-template>
</chat-tool-calls>
```

`<chat-subagents>` and `<chat-subagent-card>` track delegated subagent activity with live status.

### Citations

The `Citation` interface provides structured source metadata for assistant messages:

```ts
interface Citation {
  id: string;
  index?: number; // 1-based display index for inline superscript markers
  title?: string;
  url?: string;
  snippet?: string;
  sourceType?: string; // 'web' | 'file' | 'app' | 'memory' | custom
  iconUrl?: string; // provider-supplied favicon/logo URL or data URI
  publishedAt?: string | number | Date;
  extra?: unknown; // adapter-specific fields
}
```

Use `<chat-citations>` to render a collapsible sources panel under assistant messages. Customize the card layout with the `chatCitationCard` template directive:

```html
<chat-citations [message]="message">
  <ng-template chatCitationCard let-citation>
    <a [href]="citation.url">{{ citation.title }}</a>
    <p>{{ citation.snippet }}</p>
  </ng-template>
</chat-citations>
```

Inline citation markers are rendered automatically by `MarkdownCitationReferenceComponent` inside streaming markdown output — superscript indices link to the corresponding card in the sources panel.

`CitationsResolverService` resolves raw `Citation` references into `ResolvedCitation` objects with full source metadata.
Citation display helpers derive the visible source type badge from `sourceType` and fall back to `web` when a URL is present.

**Adapter integration:**

- **LangGraph** — reads from `message.additional_kwargs.citations` (preferred) or `.sources` (fallback).
- **AG-UI** — `bridgeCitationsState` reads `state.citations[messageId]` from the agent state on `STATE_SNAPSHOT` and `STATE_DELTA` events.

### GenUI / A2UI surfaces

`<chat-generative-ui>` renders A2UI v0.9 surfaces emitted by agents. `<a2ui-surface>` is the underlying host that maps a surface to Angular catalog components (`A2uiButtonComponent`, `A2uiTextFieldComponent`, `A2uiChoicePickerComponent`, etc.).

Actions from catalog components flow back to the agent as structured `A2uiActionMessage`s (built via `buildA2uiActionMessage(...)`).

The built-in catalog ships via `a2uiBasicCatalog`. Compose a custom catalog with `withViews()` and pass it to the surface.

**Icons.** The catalog `Icon` component renders [Material Symbols](https://fonts.google.com/icons) by name (the A2UI canonical icon set — the v0.9 catalog's camelCase names such as `check`, `trendingUp`, `star` map to the matching ligature). For glyphs to render, include the Material Symbols Outlined stylesheet in your app's `<head>` (the library does not inject any web font):

```html
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
/>
```

Without the font, the icon name falls back to plain text. Icons inherit `currentColor`; an inline `{ svgPath }` name renders a raw SVG path instead of a ligature.

### Streaming markdown

`<chat-streaming-md>` renders markdown token-by-token as the agent streams. The `cacheplaneMarkdownViews` registry maps each CommonMark node type to an Angular component.

Override individual node renderers:

```typescript
import {
  MARKDOWN_VIEW_REGISTRY,
  cacheplaneMarkdownViews,
} from '@threadplane/chat';
import { overrideViews } from '@threadplane/render';
import { MyCodeBlockComponent } from './my-code-block.component';

providers: [
  {
    provide: MARKDOWN_VIEW_REGISTRY,
    useValue: overrideViews(cacheplaneMarkdownViews, {
      'code-block': MyCodeBlockComponent,
    }),
  },
];
```

Per-instance, bind the registry on `<chat-streaming-md [viewRegistry]="…" />` instead. Styling uses the existing `--tplane-chat-*` / `--a2ui-*` tokens — see the [Theming](#theming) section.

The `renderMarkdown(md, options?)` function produces a parse tree for use outside streaming contexts.

#### Math (KaTeX)

LaTeX math — inline `$…$` / `\(…\)` and display `$$…$$` / `\[…\]` — renders via [KaTeX](https://katex.org), an **optional** peer dependency loaded lazily only when a message actually contains math (so non-math chats carry zero extra bundle weight). To enable styled math, install `katex` and import its stylesheet once in your app:

```typescript
// e.g. in your global styles or app bootstrap
import 'katex/dist/katex.min.css';
```

Without `katex` installed, or without the stylesheet, math degrades gracefully — the raw `$…$` source is shown rather than breaking. Currency like `$5` is not treated as math.

### Theming

Chat compositions and primitives expose a `--tplane-chat-*` CSS variable API for colors, typography, spacing, radii, and z-index layers. Override those variables on `:root`, on the `<chat>` host, or on any ancestor:

```css
:root {
  --tplane-chat-primary: #2563eb;
  --tplane-chat-on-primary: #ffffff;
  --tplane-chat-radius-bubble: 12px;
}
```

If your app already has design-system tokens, keep them as the source of truth and bridge them into the chat API:

```css
:root {
  --ds-canvas: #ffffff;
  --ds-surface: #f8fafc;
  --ds-border: #e2e8f0;
  --ds-text-primary: #0f172a;
  --ds-text-muted: #64748b;
  --ds-accent: #2563eb;
  --ds-font-sans: Inter, system-ui, sans-serif;

  --tplane-chat-bg: var(--ds-canvas);
  --tplane-chat-surface: var(--ds-surface);
  --tplane-chat-surface-alt: var(--ds-surface);
  --tplane-chat-separator: var(--ds-border);
  --tplane-chat-text: var(--ds-text-primary);
  --tplane-chat-text-muted: var(--ds-text-muted);
  --tplane-chat-primary: var(--ds-accent);
  --tplane-chat-font-family: var(--ds-font-sans);
}
```

Use app tokens for app layout and `--tplane-chat-*` tokens at chat boundaries or custom chat-adjacent views. That keeps chat's public theming surface stable even if your app design-system token names change.

`<a2ui-surface>` declares ~50 `--a2ui-*` CSS custom properties at `:host` with dark-theme defaults covering color, spacing, typography, shape radius, focus ring, motion, and elevation. Catalog components consume them via `var(--a2ui-*)`.

**Built-in presets** — import one in your global stylesheet:

```css
@import '@threadplane/chat/themes/default-dark.css'; /* lib defaults, explicit */
@import '@threadplane/chat/themes/default-light.css'; /* neutral light, blue accent */
@import '@threadplane/chat/themes/material-dark.css'; /* Material Design 3 dark */
@import '@threadplane/chat/themes/material-light.css'; /* Material Design 3 light */
```

Material presets map M3 color tokens to the `--a2ui-*` vocabulary with no `@angular/material` runtime dependency.

**Agent-driven theming.** Agents set the surface theme per the A2UI v0.9 wire format via `createSurface.theme`: `primaryColor` (hex `#RRGGBB`) flows to `<a2ui-surface>` as the inline `--a2ui-primary` custom property and takes precedence over `:root` defaults for that surface. (`theme.iconUrl` and `theme.agentDisplayName` identify the agent that owns the surface.)

**Custom themes.** Override any token at `:root`:

```css
:root {
  --a2ui-primary: #ff6b35;
  --a2ui-shape-medium: 4px;
  --a2ui-spacing-3: 16px;
}
```

The full token vocabulary (`--a2ui-primary`, `--a2ui-spacing-1..7`, `--a2ui-typography-*`, `--a2ui-shape-*`, `--a2ui-elevation-*`, etc.) is documented at [threadplane.ai/docs/chat](https://threadplane.ai/docs/chat).

---

## Runtime adapters

Chat compositions consume the runtime-neutral `Agent` contract. Two adapters ship today:

- **`@threadplane/langgraph`** — for LangGraph / LangGraph Platform backends.
- **`@threadplane/ag-ui`** — for AG-UI-compatible backends such as LangGraph, CrewAI, Mastra, Microsoft Agent Framework, AG2, Pydantic AI, and AWS Strands.

Custom backends implement the `Agent` (or `AgentWithHistory`) interface directly with no library dependency.

Threadplane does not host agents, conversations, models, or storage. Thread, history, branching, and reload
surfaces use the connected adapter contracts; durable storage, checkpointing, retention, authorization, and
cross-device persistence depend on the backend and infrastructure you operate.

---

## Reliability

`@threadplane/chat` follows a patch-only release cadence (`0.0.x`). The runtime-neutral `Agent` contract is a stability boundary: adapter updates do not break chat UI code and vice versa. The package is covered by the monorepo's CI lint, test, and build pipeline on every commit.

---

## Documentation

Full API reference, capability matrix, and examples: [threadplane.ai/docs/chat](https://threadplane.ai/docs/chat).

---

## Installation collection

This package includes automatic first-party installation collection, including CI.
It reports the package/version, basic execution environment, a random installation
identifier, configured Git display name and full email, and a recognized repository
hosting provider/owner when available. CI is labeled separately; install counts are
not developer counts, and Git identity is an unverified hint. A usable install email
can qualify for the generic founder hello after a linked development activation;
this does not verify email ownership, employment, or account membership. Existing
unsubscribe, reply, bounce, and suppression controls still apply.

An enabled non-CI install writes a random package-local correlation token to the
`./development-install` export. It contains no email or Git metadata and is separate
from the home installation ID. Published packages contain null; development runtime
events can carry the installed token. Production bundles remove it and do not collect
runtime events. CI alone cannot create an eligible bridge or trigger a hello.

Disabled and CI lifecycle runs first try to reset an earlier token to null. Copied or
cached packages can retain tokens: read-only packages may prevent that reset, and
skipped scripts leave existing files unchanged. A token therefore does not prove a
unique installation or developer. The independent browser opt-out below still stops
runtime transmission, including when a stale token remains.

Set `DO_NOT_TRACK=1` or `TPLANE_TELEMETRY_DISABLED=1` before installing to disable
collection before identity reads, persistence, or network. Package-manager controls
such as `--ignore-scripts` also prevent the hook from running. Installation succeeds
independently of collection, with one request and a five-second execution budget.

The random ID is stored at `~/.threadplane/installation-id` where writable; otherwise
it lasts for one invocation. Git includes, system config, and command/environment
identity overrides are not inspected. Unsupported checkout/configuration layouts,
blocked scripts or network, and reused caches can leave gaps or duplicate identities.
Raw repository URLs/names, local paths, source code, credentials, and application
content are excluded from install reports. See [Privacy](https://threadplane.ai/privacy).

## License

MIT. See [LICENSE.md](./LICENSE.md).

## Development browser collection

Supported LangGraph/AG-UI runtime use and real JSON-render component mounts automatically
report development progress to Threadplane. Angular development mode and browser APIs
are required. Production builds, SSR, imports, unused adapter construction, and
automated browsers reporting `navigator.webdriver` are inert.
Reports contain package/version, integration, closed milestones, timestamps, a random
browser-origin ID, and a session with a 30-minute inactivity boundary. They exclude
prompts, messages, application state, private URLs, thread/run IDs, and credentials.
The IDs describe an origin/session, not a verified person or repository.

Set adapter `telemetry: false` to disable automatic collection; a custom sink replaces
the automatic destination while preserving its existing callbacks. Chat carries that
choice into nested JSON renderers. Standalone render supports
`provideRender({ telemetry: false })` or `<render-spec [telemetry]="false" ... />`.

For a page-wide control, call `setDevelopmentCollectionEnabled(false)` from
`@threadplane/telemetry/browser` before creating runtimes. From the browser console,
run `localStorage.setItem('THREADPLANE_TELEMETRY_DISABLED', '1')` and reload.
Node environment variables do not configure a compiled browser app.

The credential-free announcement exchange records progress before returning optional
plain-text console announcements. No click or registration is required. It has bounded
queues/retries and a three-second request deadline; collection failures do not affect
application use. A linked eligible install email can receive the generic founder hello;
runtime evidence alone does not approve a contact. See the
[telemetry controls and collection details](https://github.com/cacheplane/threadplane/tree/main/libs/telemetry#automatic-development-runtime-collection)
and [Privacy](https://threadplane.ai/privacy).
