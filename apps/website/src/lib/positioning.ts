// ── Homepage copy (spec 2026-09-02-homepage-rebuild-design.md §4.1) ──────────
import { WEBSITE_SUPPORTED_ANGULAR_MAJORS } from '../components/pricing/angular-support.mjs';

export const HERO_EYEBROW = 'LangGraph & AG-UI';
export const HERO_H1 = 'The open source (and free) threadplane for agents';
/**
 * Shared phrase breaks for the homepage and fixed social-card frames.
 */
export const HERO_H1_LINES: readonly string[] = [
  'The open source',
  '(and free)',
  'threadplane for agents',
];
export const HERO_SUBHEAD =
  'Make agent work persistent, durable, visible, reviewable, and resumable.';

export const HERO_PRIMARY_LABEL = 'Install Threadplane';
export const HERO_SECONDARY_LABEL = 'See it running in the docs →';
export const HERO_SECONDARY_HREF = '/docs/angular/chat/guides/generative-ui?mode=run';

/** Kept for layout.tsx default title and the OG image alt. */
export const PRIMARY_TAGLINE = 'Threadplane — The open-source threadplane for agents';
export const HOME_TITLE = PRIMARY_TAGLINE;
export const HOME_DESCRIPTION =
  'The open-source UI layer for agents: chat, durable threads, human approvals, and generative UI. Connect your app to LangGraph and AG-UI.';
/** Longer form used by layout.tsx OG/Twitter defaults and the About page. */
export const LONG_SUBHEAD =
  'Threadplane is the open-source threadplane for agents: streaming chat, durable threads, persistence, human approvals, tool progress, subagents, and generative UI, on LangGraph and AG-UI — without replacing your backend or design system.';

// ── Trust line (values verified by positioning.spec.ts + angular-support-copy.spec.ts) ──
export function formatAngularRange(majors: readonly number[]): string {
  const sorted = [...majors].sort((a, b) => a - b);
  return sorted.length > 1 ? `Angular ${sorted[0]}–${sorted[sorted.length - 1]}` : `Angular ${sorted[0]}`;
}
export const HERO_TRUST_LINE = `MIT · ${formatAngularRange(WEBSITE_SUPPORTED_ANGULAR_MAJORS)} · no account, no cloud`;

/**
 * The public source repository.
 *
 * It lives here, not in site-metadata.ts: that module reaches node:fs through
 * blog.ts, so importing it from a client component drags the filesystem into
 * the browser bundle and the page 500s. positioning.ts is client-safe — the
 * hero already imports it.
 */
export const GITHUB_REPO_URL = 'https://github.com/cacheplane/threadplane';

// ── Install variants: the ONE place install commands live on the website ─────
export type InstallVariant = 'fake' | 'langgraph' | 'ag_ui';

export interface InstallOption {
  readonly key: InstallVariant;
  readonly label: string;
  readonly description: string;
  readonly command: string;
  readonly peersNote: string;
  readonly providerSnippet: string;
  readonly quickstartHref: string;
}

export const COMPONENT_SNIPPET = `import { Component } from '@angular/core';
import { injectAgent } from '@threadplane/langgraph';
import { ChatComponent } from '@threadplane/chat';

@Component({
  imports: [ChatComponent],
  template: \`<chat [agent]="agent" />\`,
})
export class SupportAgentComponent {
  protected readonly agent = injectAgent();
}`;

/**
 * Step 3 of the mechanism section: registering your own design-system
 * components so generated UI can only render what you already own.
 * Mirrors the real API — `provideViews(views({ … }))` from @threadplane/render.
 */
export const RENDER_SNIPPET = `import { ApplicationConfig } from '@angular/core';
import { provideViews, views } from '@threadplane/render';
import { KpiCardComponent } from './kpi-card.component';
import { DisruptionsTableComponent } from './disruptions-table.component';

export const appConfig: ApplicationConfig = {
  providers: [
    // Generated UI can render these components and nothing else.
    provideViews(views({
      KpiCard: KpiCardComponent,
      DisruptionsTable: DisruptionsTableComponent,
    })),
  ],
};`;

export const INSTALL_OPTIONS: readonly InstallOption[] = [
  {
    key: 'fake',
    label: 'Try without a backend',
    description: 'Runs a fake agent in the browser. Swap in a real adapter when the UI works.',
    command: 'npm install @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked',
    peersNote: `${formatAngularRange(WEBSITE_SUPPORTED_ANGULAR_MAJORS)} · the LangGraph SDK is a peer of the adapter, marked a peer of the chat package`,
    providerSnippet: `import { ApplicationConfig } from '@angular/core';
import { provideFakeAgent } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideFakeAgent({ tokens: ['Hello', ' from', ' Threadplane'] }),
  ],
};`,
    quickstartHref: '/docs/angular/chat/getting-started/try-without-a-backend',
  },
  {
    key: 'langgraph',
    label: 'LangGraph',
    description: 'Connect a LangGraph Platform or langgraph dev server.',
    command: 'npm install @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked',
    peersNote: `${formatAngularRange(WEBSITE_SUPPORTED_ANGULAR_MAJORS)} · the LangGraph SDK is a peer of the adapter, marked a peer of the chat package`,
    providerSnippet: `import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({ apiUrl: 'http://localhost:2024', assistantId: 'agent' }),
  ],
};`,
    quickstartHref: '/docs/angular/langgraph/getting-started/quickstart',
  },
  {
    key: 'ag_ui',
    label: 'AG-UI',
    description: 'Connect any AG-UI-compatible endpoint.',
    command: 'npm install @threadplane/chat @threadplane/ag-ui @ag-ui/client @ag-ui/core marked',
    peersNote: `${formatAngularRange(WEBSITE_SUPPORTED_ANGULAR_MAJORS)} · the AG-UI client is a peer of the adapter, marked a peer of the chat package`,
    providerSnippet: `import { ApplicationConfig } from '@angular/core';
import { provideAgent } from '@threadplane/ag-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({ url: 'http://localhost:8000/agent' }),
  ],
};`,
    quickstartHref: '/docs/angular/ag-ui/getting-started/quickstart',
  },
];

// ── Coding-agent quickstart prompt ───────────────────────────────────────────
export const CODING_AGENT_PROMPT = `Add Threadplane to this Angular application.

1. Read https://threadplane.ai/AGENTS.md and the current Threadplane quickstart.
2. Inspect this repository's Angular version, application configuration, design
   system, test runner, and existing agent/backend code.
3. Begin with Threadplane's provideFakeAgent() path so the UI can be verified
   without a server or LLM.
4. Render the smallest accessible <chat> experience using the app's existing
   layout and styles.
5. Add a focused test for the integration.
6. After the fake path passes, explain the exact configuration needed for
   either LangGraph or AG-UI. Do not invent credentials, endpoint URLs, or
   backend capabilities.
7. Run the repository's relevant lint, test, and build commands and report
   every changed file.`;

// ── OG image + keywords (unchanged) ─────────────────────────────────────────
export interface PositioningProofPoint {
  readonly label: string;
  readonly href: string;
}

export const POSITIONING_PROOF_POINTS: readonly PositioningProofPoint[] = [
  { label: 'LangGraph + AG-UI', href: '/docs/choosing-an-adapter' },
  { label: 'Durable threads', href: '/docs/angular/langgraph/guides/persistence' },
  { label: 'Interrupts', href: '/docs/angular/langgraph/guides/interrupts' },
  { label: 'Subagents', href: '/docs/angular/langgraph/guides/subgraphs' },
  { label: 'Planning + memory', href: '/docs/angular/langgraph/guides/memory' },
  { label: 'json-render + A2UI', href: '/docs/angular/render/concepts/json-render-vs-a2ui' },
] as const;
export const SHORT_POSITIONING_DESCRIPTION = HOME_DESCRIPTION;
export const DEFAULT_META_DESCRIPTION = SHORT_POSITIONING_DESCRIPTION;
