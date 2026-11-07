/**
 * Solutions pages are hand-written, not templated at scale.
 *
 * This file drives `/solutions/[slug]`, which makes it look like a page
 * generator. It is not one, and it must not become one. Google's
 * scaled-content-abuse policy targets exactly this shape: families of
 * programmatically generated pages that differ only by keyword.
 *
 * The rule: every entry must carry genuinely distinct first-hand content —
 * a real problem we have seen, a real architecture, real code. If a new
 * entry would amount to a find-and-replace of an existing one (swap the
 * vertical noun, keep the structure and the claims), do not add it. Write a
 * blog post or a docs guide instead, where the thing you actually have to
 * say can stand on its own.
 *
 * "Real code" is a required field, not an aspiration: `code` must be a working
 * snippet against the published API, and each entry's snippet must show a
 * DIFFERENT part of the stack from its siblings. Two entries that both reduce
 * to "call interrupt(), then approve it" are the find-and-replace this rule
 * exists to prevent, however different their prose is.
 *
 * `solutions-data.spec.ts` enforces what can be enforced mechanically —
 * unique proof-point markers, a distinct code snippet per entry. The
 * editorial judgement above is still yours.
 *
 * Adding an entry is an editorial decision, not a data-file edit.
 *
 * See https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
 */
import { HITL_CLIP, type DemoClip } from './demo-media';

export interface SolutionPainPoint {
  title: string;
  description: string;
}

export interface ArchitectureLayer {
  library: string;
  pkg: string;
  role: string;
}

/**
 * Framework capability — paired short marker with a longer label.
 * Used to be a numeric "proof point" with invented metrics; replaced
 * with honest, defensible capability claims grounded in what the
 * libraries actually do.
 */
export interface ProofPoint {
  metric: string;
  label: string;
}

/**
 * A working snippet against the published API — see the file header. The
 * `language` is a Shiki identifier; `label` names the file or layer it comes
 * from so the reader knows where it belongs.
 */
export interface SolutionCode {
  label: string;
  language: 'typescript' | 'python' | 'html';
  source: string;
}

/**
 * The blocks an entry shows, in reading order. An array because the Angular
 * story is rarely one file — a component and the template that drives it say
 * more together than either does alone.
 */
export type SolutionCodeBlocks = readonly SolutionCode[];

export interface SolutionConfig {
  slug: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  painPoints: SolutionPainPoint[];
  architectureIntro: string;
  architectureLayers: ArchitectureLayer[];
  proofPoints: ProofPoint[];
  code: SolutionCodeBlocks;
  /**
   * OPTIONAL, and it must stay optional. A clip belongs on an entry only when
   * it shows that entry's actual claim — the same footage under a heading it
   * does not illustrate is the padding this file's header warns about.
   * `analytics` has no approval story, so it carries no clip.
   */
  demo?: DemoClip;
  ctaHeadline: string;
  ctaSubtext: string;
  metaTitle: string;
  metaDescription: string;
}

export const SOLUTIONS: SolutionConfig[] = [
  {
    slug: 'compliance',
    eyebrow: 'Compliance & Audit',
    title: 'AI agents your compliance\nteam will actually approve',
    subtitle: 'Human-in-the-loop approvals, auditable thread history, and deterministic testing — built into the framework, not bolted on.',
    painPoints: [
      {
        title: 'Black-box AI decisions',
        description: 'An answer alone cannot explain a decision. Reviewers need the tool activity, context, and human decisions that led to it.',
      },
      {
        title: 'No human gate before action',
        description: 'Sensitive workflows need a clear place for a person to review a proposed action. That decision belongs in the flow, with the context to make it.',
      },
      {
        title: 'Untestable agent behavior',
        description: 'Compliance needs reproducible test evidence. Non-deterministic LLM calls make that nearly impossible without the right tooling.',
      },
    ],
    architectureIntro: 'Three libraries give your compliance team what they need — without slowing your engineering team down.',
    architectureLayers: [
      {
        library: 'Agent',
        pkg: '@threadplane/langgraph',
        role: 'Production agent state with first-class interrupt support. Every agent action can require human approval before execution. Durable thread persistence preserves the full record of every tool call and state transition.',
      },
      {
        library: 'json-render',
        pkg: '@threadplane/render',
        role: 'Approval workflows rendered as structured UI — not chat messages. The agent proposes an action, renders a confirmation card, and waits for the human gate before proceeding.',
      },
      {
        library: 'Chat',
        pkg: '@threadplane/chat',
        role: 'Debug overlay shows every tool call, interrupt, and state transition. Your compliance team can review exactly what happened, when, and why — in a UI they can understand.',
      },
    ],
    proofPoints: [
      { metric: 'Recorded', label: 'Tool calls, interrupts, and state transitions captured in the thread record' },
      { metric: 'Evidenced', label: 'Each approval is written into the checkpoint beside the action it gated — the decision and the proposal are one record' },
      { metric: 'Replayable', label: 'Thread persistence preserves the full decision path for review by auditors and your compliance team' },
    ],
    code: [
      {
        label: 'audit-trail.component.ts — reading the thread record',
        language: 'typescript',
        source: `export class AuditTrailComponent {
  private readonly agent = injectAgent(REVIEW_AGENT);

  // Runtime-neutral timeline: every checkpoint the thread passed through.
  readonly checkpoints = computed(() => this.agent.history());

  // Raw LangGraph ThreadState[], for the fields an auditor asks about.
  private readonly raw = computed(() => this.agent.langGraphHistory());

  // The decisions themselves, lifted out of the checkpoint values. Each row
  // pairs what was proposed with what a human answered, and when.
  readonly approvals = computed(() =>
    this.raw()
      .filter((state) => state.values?.['approval_result'])
      .map((state) => ({
        at: state.created_at,
        action: state.values['proposed_action'],
        decision: state.values['approval_result'],
      })),
  );
}`,
      },
      {
        label: 'audit-trail.component.html',
        language: 'html',
        source: `<table class="audit">
  @for (row of approvals(); track row.at) {
    <tr>
      <td>{{ row.at | date: 'medium' }}</td>
      <td>{{ row.action.description }}</td>
      <td>{{ row.decision.approved ? 'Approved' : 'Rejected' }}</td>
      <td>{{ row.decision.reason }}</td>
    </tr>
  }
</table>

<p class="muted">{{ checkpoints().length }} checkpoints on this thread.</p>`,
      },
    ],
    demo: HITL_CLIP,
    ctaHeadline: 'Ship compliant AI agents — without the compliance tax',
    ctaSubtext: 'Download the field report or start a pilot. Your compliance team will thank you.',
    metaTitle: 'Compliance & Audit — Threadplane Solutions',
    metaDescription: 'Ship AI agents with human-in-the-loop approvals, auditable thread history, and deterministic testing. Built for SOX, HIPAA, and GDPR workflows.',
  },
  {
    slug: 'analytics',
    eyebrow: 'Analytics & BI',
    title: 'Natural language queries.\nReal-time dashboards.',
    subtitle: 'Your users ask questions in plain English. The agent queries, visualizes, and streams results — all inside your product.',
    painPoints: [
      {
        title: 'BI tools users won\'t adopt',
        description: 'Complex dashboards with steep learning curves. Business users want answers, not another tool to learn.',
      },
      {
        title: 'Static reports, stale data',
        description: 'Pre-built dashboards can\'t answer ad-hoc questions. By the time a report is built, the question has changed.',
      },
      {
        title: 'Chat-only AI interfaces',
        description: 'Text answers aren\'t enough for data. Users need charts, tables, and interactive visualizations — streamed in real time.',
      },
    ],
    architectureIntro: 'Three libraries turn your LangGraph agent into a conversational BI surface your business users will actually use.',
    architectureLayers: [
      {
        library: 'Agent',
        pkg: '@threadplane/langgraph',
        role: 'Streams query results token-by-token as the LangGraph agent reasons over your data. Thread persistence means users can refine questions without re-running expensive queries.',
      },
      {
        library: 'json-render',
        pkg: '@threadplane/render',
        role: 'The agent emits chart specs, data tables, and KPI cards as structured render specs. Your Angular components render them with streaming JSON patches — live-updating visualizations as data arrives.',
      },
      {
        library: 'Chat',
        pkg: '@threadplane/chat',
        role: 'Generative UI surfaces render charts and tables inline with the conversation. Users ask follow-up questions and see updated visualizations without leaving the chat.',
      },
    ],
    proofPoints: [
      { metric: 'Plain English', label: 'No SQL required — the agent generates queries from natural-language input' },
      { metric: 'Streaming', label: 'Token-level updates as the agent reasons over your data — first results visible before completion' },
      { metric: 'Inline', label: 'Charts, tables, and KPI cards rendered into the conversation as Angular components you already own' },
    ],
    code: [
      {
        label: 'dashboard.component.ts — the view catalog',
        language: 'typescript',
        source: `import { ChatComponent, views } from '@threadplane/chat';
import { injectAgent } from '@threadplane/langgraph';

// Your components, keyed by the name the agent uses in its spec.
// Nothing here knows what question the user will ask.
const analyticsViews = views({
  bar_chart: BarChartComponent,
  data_table: DataTableComponent,
  kpi_card: KpiCardComponent,
});

export class DashboardComponent {
  protected readonly agent = injectAgent();
  protected readonly analyticsViews = analyticsViews;
}`,
      },
      {
        label: 'dashboard.component.html',
        language: 'html',
        source: `<!-- ChatComponent detects a JSON spec in the AI message and renders it
     through the catalog. Partial specs render as they stream, so the first
     chart appears before the query has finished. -->
<chat [agent]="agent" [views]="analyticsViews" />`,
      },
    ],
    ctaHeadline: 'Turn your data into conversations',
    ctaSubtext: 'Download the field report or start a pilot. Ship a conversational BI experience in weeks, not quarters.',
    metaTitle: 'Analytics & BI — Threadplane Solutions',
    metaDescription: 'Build conversational BI with natural language queries, streaming results, and generative UI — all in Angular.',
  },
  {
    slug: 'customer-support',
    eyebrow: 'Customer Support',
    title: 'AI agents that know when\nto escalate to a human',
    subtitle: 'Resolve routine tickets autonomously, surface context instantly, and hand off to humans seamlessly — with full conversation history.',
    painPoints: [
      {
        title: 'Chatbots that frustrate customers',
        description: 'Scripted chatbots can\'t handle nuance. Customers get stuck in loops, abandon the chat, and call the support line anyway.',
      },
      {
        title: 'Agents without guardrails',
        description: 'Autonomous agents that can\'t escalate are a liability. One wrong refund, one leaked detail, and trust is gone.',
      },
      {
        title: 'Context lost on handoff',
        description: 'When a bot hands off to a human, the conversation history disappears. The customer repeats everything. CSAT drops.',
      },
    ],
    architectureIntro: 'Three libraries give your support agents superpowers — and your customers a seamless experience.',
    architectureLayers: [
      {
        library: 'Agent',
        pkg: '@threadplane/langgraph',
        role: 'LangGraph interrupts let the agent pause before sensitive actions — refunds, account changes, escalations. Thread persistence preserves the full conversation across bot-to-human handoffs.',
      },
      {
        library: 'json-render',
        pkg: '@threadplane/render',
        role: 'The agent renders structured UI — order summaries, refund confirmations, knowledge base cards — instead of dumping text. Customers see clean, actionable information.',
      },
      {
        library: 'Chat',
        pkg: '@threadplane/chat',
        role: 'Production-ready chat UI with streaming messages, tool call visibility, and interrupt panels. When the agent escalates, the human agent sees the full debug overlay with every step the AI took.',
      },
    ],
    proofPoints: [
      { metric: 'Preserved', label: 'Full conversation history across bot-to-human handoff — no repeating the question, no re-explaining the problem' },
      { metric: 'Named', label: 'Refunds and account changes resume only with an identified approver — the agent cannot self-authorize' },
      { metric: 'Visible', label: 'Tool-call replay for human agents on escalation — see every step the AI took before the handoff' },
    ],
    code: [
      {
        label: 'support-chat.component.ts — the escalation gate',
        language: 'typescript',
        source: `export class SupportChatComponent {
  protected readonly agent = injectAgent(SUPPORT_AGENT);

  // Populated only while the graph is paused on an interrupt.
  readonly pendingRefund = computed(() => this.agent.interrupt());
  readonly awaitingHuman = computed(() => this.pendingRefund() !== null);

  // Resuming carries the approver, so the record shows who authorized it —
  // the agent has no path to approve its own refund.
  approveRefund(approver: string) {
    this.agent.submit({ resume: { approved: true, approver } });
  }

  denyRefund(reason: string) {
    this.agent.submit({ resume: { approved: false, reason } });
  }

  send(message: string) {
    this.agent.submit({ message });
  }
}`,
      },
      {
        label: 'support-chat.component.html',
        language: 'html',
        source: `<chat [agent]="agent" />

@if (pendingRefund(); as pending) {
  <aside class="approval">
    <h3>{{ pending.value.action }} — {{ pending.value.amount | currency }}</h3>
    <p>{{ pending.value.reason }}</p>

    <button (click)="approveRefund(currentAgentName())">Approve</button>
    <button (click)="denyRefund('Outside policy')">Deny</button>
  </aside>
}`,
      },
    ],
    demo: HITL_CLIP,
    ctaHeadline: 'Support agents that make your team better',
    ctaSubtext: 'Download the field report or start a pilot. Resolve routine tickets, escalate the rest with full context, keep your customers happy.',
    metaTitle: 'Customer Support — Threadplane Solutions',
    metaDescription: 'Build AI support agents with human escalation, full context handoff, and production-ready chat UI in Angular.',
  },
];

export function getSolutionBySlug(slug: string): SolutionConfig | undefined {
  return SOLUTIONS.find(s => s.slug === slug);
}

export function getAllSolutionSlugs(): string[] {
  return SOLUTIONS.map(s => s.slug);
}
