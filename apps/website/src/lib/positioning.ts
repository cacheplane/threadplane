// ── Homepage copy (spec 2026-09-02-homepage-rebuild-design.md §4.1) ──────────
import { WEBSITE_SUPPORTED_ANGULAR_MAJORS } from '../components/pricing/angular-support.mjs';
import type { StageBeat } from './stage-beats';

export const HERO_EYEBROW = 'Angular · LangGraph & AG-UI';
export const HERO_H1 = 'The open-source thread-plane for agents.';
/**
 * The H1 broken where it is meant to break: three lines, one thought each.
 * HERO_H1 stays the single source of truth — positioning.spec.ts asserts the
 * lines join back to it with single spaces, so the rendered heading, the
 * <title> and the social card cannot drift apart.
 */
export const HERO_H1_LINES: readonly string[] = ['The open-source', 'thread-plane', 'for agents.'];
export const HERO_SUBHEAD =
  'Make agent work persistent, durable, visible, reviewable, and resumable.';

/**
 * The subhead, split so each workflow capability links to its documentation.
 * HERO_SUBHEAD stays the single source of truth: positioning.spec.ts asserts
 * these segments join back to it character for character, so the two cannot
 * drift. Linked terms retain the hero's ink underline treatment.
 */
export interface HeroSubheadSegment {
  text: string;
  href?: string;
}
export const HERO_SUBHEAD_SEGMENTS: readonly HeroSubheadSegment[] = [
  { text: 'Make agent work ' },
  { text: 'persistent', href: '/docs/langgraph/guides/persistence' },
  { text: ', ' },
  { text: 'durable', href: '/docs/langgraph/guides/persistence#choosing-a-checkpointer' },
  { text: ', ' },
  { text: 'visible', href: '/docs/chat/components/chat-tool-calls' },
  { text: ', ' },
  { text: 'reviewable', href: '/docs/langgraph/guides/interrupts' },
  { text: ', and ' },
  { text: 'resumable', href: '/docs/langgraph/guides/persistence#checkpoint-recovery' },
  { text: '.' },
];

export const HERO_PRIMARY_LABEL = 'Install Threadplane';
export const HERO_SECONDARY_LABEL = 'See it running in the docs →';
export const HERO_SECONDARY_HREF = '/docs/chat/guides/generative-ui?mode=run';

/** Kept for layout.tsx default title and the OG image alt. */
export const PRIMARY_TAGLINE = 'Threadplane — The open-source thread-plane for agents';
export const HOME_TITLE = PRIMARY_TAGLINE;
export const HOME_DESCRIPTION =
  'The open-source thread-plane for agents: chat, durable threads, persistence, human approvals, and generative UI for Angular, on LangGraph and AG-UI.';
/** Longer form used by layout.tsx OG/Twitter defaults and the About page. */
export const LONG_SUBHEAD =
  'Threadplane is the open-source thread-plane for agents: signal-native chat, durable threads, persistence, human approvals, tool progress, subagents, and generative UI for Angular, on LangGraph and AG-UI — without replacing your backend or design system.';

// ── Trust line (values verified by positioning.spec.ts + angular-support-copy.spec.ts) ──
export function formatAngularRange(majors: readonly number[]): string {
  const sorted = [...majors].sort((a, b) => a - b);
  return sorted.length > 1 ? `Angular ${sorted[0]}–${sorted[sorted.length - 1]}` : `Angular ${sorted[0]}`;
}
export const HERO_TRUST_LINE = `MIT · ${formatAngularRange(WEBSITE_SUPPORTED_ANGULAR_MAJORS)} · no account, no cloud`;

// ── The final mile (live-stage spec §3, block 3) ─────────────────────────────

/**
 * The public source repository.
 *
 * It lives here, not in site-metadata.ts: that module reaches node:fs through
 * blog.ts, so importing it from a client component drags the filesystem into
 * the browser bundle and the page 500s. positioning.ts is client-safe — the
 * hero already imports it.
 */
export const GITHUB_REPO_URL = 'https://github.com/cacheplane/threadplane';

// ── The open-source band (the dark full stop after the stage). An eyebrow,
// two words, the licence and the repo. It used to be the quietest band on the
// page; it is now loud on purpose, because the offer — no catch, and the
// remedy for disagreeing with us is a fork — is one of the strongest things
// the product has to say. ───────────────────────────────────────────────────
export const OPEN_SOURCE_STRIP = {
  /**
   * The US transponder code for VFR flight not receiving ATC services —
   * flying with nobody controlling you, which is the offer exactly. It is
   * texture, not information: the headline carries the whole meaning, so a
   * reader who does not fly loses nothing.
   */
  eyebrow: 'Squawk 1200',
  /** Two words at up to 116px. The band's entire argument. */
  headline: 'Fork us.',
  /** The bare licence, set in mono after the action. */
  licence: 'MIT',
  cta: 'Fork on GitHub',
} as const;

// ── The No-runtime band (dark, between the architecture diagram and Fork us;
// spec 2026-09-11). Threadplane's adapters call your LangGraph or AG-UI server
// from the browser: there is no server of ours in the request path, no key,
// no dev-only flag, no production tier. Other agent UI kits ship a "runtime"
// that sits between the two; this band states our shape and names nobody. ──
export const NO_RUNTIME_BAND = {
  /**
   * Controller phraseology for a clearance straight to a fix, skipping the
   * intermediate ones. Texture, like "Squawk 1200": the headline carries the
   * meaning, so a reader who does not fly loses nothing.
   */
  eyebrow: 'Cleared direct',
  /** Two words at up to 116px. */
  headline: 'No runtime.',
  /**
   * "No cloud", not "no proxy": the docs tell you to put your agent behind
   * your own proxy, so "no proxy" would be false.
   */
  body:
    'Your users reach your LangGraph or AG-UI server from your Angular app. Nothing of ours in between: no cloud, no key, no dev-only flag.',
  link: {
    label: 'How it is wired',
    href: '/docs/choosing-an-adapter',
  },
  /**
   * The two vertical flows. `ghost` is the node drawn dashed and struck
   * through: the hop that is not there with Threadplane. "Your users" echoes
   * the first column label of the architecture diagram above the band.
   */
  flows: {
    usual: {
      label: 'The usual',
      nodes: ['Your users', 'Their runtime', 'Your agent'],
      ghost: 'Their runtime',
    },
    ours: {
      label: 'Threadplane',
      nodes: ['Your users', 'Your agent'],
    },
  },
  /** Read to assistive tech in place of the drawn flows. */
  figureCaption:
    "The usual path runs from your users through the vendor's runtime to your agent. With Threadplane your users reach your agent directly.",
} as const;

// The shared capability checklist and fallback still captions.
export type StageBeatKey = StageBeat;
export interface StageRailBeat {
  readonly beat: StageBeatKey;
  readonly label: string;
  readonly claim: string;
  readonly docs: { readonly label: string; readonly href: string };
  readonly stillAlt: string;
}
export const STAGE_HEADING = 'Everything your agent needs on screen.';
export const STAGE_SUBTITLE =
  'Follow one workflow through tools, subagents, saved threads, approvals, and generated UI.';
export const STAGE_RAIL: readonly StageRailBeat[] = [
  {
    beat: 'stream',
    label: 'Tools & citations',
    claim: 'Tools & citations',
    docs: { label: 'Docs', href: '/docs/chat/components/chat-tool-calls' },
    stillAlt:
      'A backup cleanup review with tool results and linked retention policy citations in the chat.',
  },
  {
    beat: 'subagents',
    label: 'Subagents',
    claim: 'Subagents',
    docs: { label: 'Docs', href: '/docs/langgraph/guides/subgraphs' },
    stillAlt:
      'The cleanup workflow delegates a policy review to a research subagent, with its progress and findings visible in the chat.',
  },
  {
    beat: 'persist',
    label: 'Threads & branches',
    claim: 'Threads & branches',
    docs: { label: 'Docs', href: '/docs/langgraph/guides/persistence' },
    stillAlt:
      'The saved cleanup thread restored after reload and branched from an earlier checkpoint to revise the backup plan.',
  },
  {
    beat: 'approve',
    label: 'Interrupts & approval',
    claim: 'Interrupts & approval',
    docs: { label: 'Docs', href: '/docs/langgraph/guides/interrupts' },
    stillAlt:
      'The cleanup agent paused for human review of the proposed backup deletions, with approval controls and retained backups visible.',
  },
  {
    beat: 'render',
    label: 'Generated UI',
    claim: 'Generated UI',
    docs: { label: 'Docs', href: '/render' },
    stillAlt:
      'A generated cleanup summary in the chat showing deleted and retained backups after the approved operation.',
  },
];

/** Spec §3.3: the only copy shown while recorded time is pinned at the interrupt, and the page's one scroll cue. */
export const STAGE_HOLD_LINE = 'Keep scrolling to approve.';

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
    quickstartHref: '/docs/chat/getting-started/try-without-a-backend',
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
    quickstartHref: '/docs/langgraph/getting-started/quickstart',
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
    quickstartHref: '/docs/ag-ui/getting-started/quickstart',
  },
];

/**
 * Spec §3.4: the stage's last screen. `install` is derived from the install
 * options so the command lives in one place; the fake-agent command is a
 * single line, so it is shown whole. Declared after INSTALL_OPTIONS on purpose.
 */
export const STAGE_CLOSE = {
  claim: 'One workflow. Every step in your Angular app.',
  cta: { label: 'Spike it this week', href: INSTALL_OPTIONS[0].quickstartHref },
} as const;

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
  { label: 'Durable threads', href: '/docs/langgraph/guides/persistence' },
  { label: 'Interrupts', href: '/docs/langgraph/guides/interrupts' },
  { label: 'Subagents', href: '/docs/langgraph/guides/subgraphs' },
  { label: 'Planning + memory', href: '/docs/langgraph/guides/memory' },
  { label: 'json-render + A2UI', href: '/docs/render/concepts/json-render-vs-a2ui' },
] as const;
export const SHORT_POSITIONING_DESCRIPTION = HOME_DESCRIPTION;
export const DEFAULT_META_DESCRIPTION = SHORT_POSITIONING_DESCRIPTION;
