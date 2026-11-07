/**
 * Cockpit capability -> website documentation link.
 *
 * The cockpit serves a demo per `<product>/<section>/<topic>`; the website
 * serves documentation on a three-segment route, `/docs/<library>/<section>/<slug>`
 * (see `apps/website/src/app/docs/[library]/[section]/[slug]/page.tsx`). The two
 * trees do not share a naming scheme, so the link between them is a table, not
 * a formula. An earlier five-segment formula
 * (`/docs/<product>/core-capabilities/<topic>/overview/<language>`) produced a
 * URL that 404s for every product.
 *
 * Rules for this table:
 *
 * - Values are the page that best serves someone looking at that cockpit demo.
 *   Cross-library links are expected and fine (an AG-UI demo whose most useful
 *   page lives under `chat` links to `chat`).
 * - `NO_COCKPIT_DOCS_LINK` (the empty string) is the sentinel for "no published
 *   page covers this yet". Consumers must not render a link for it. Every
 *   sentinel entry is listed in `COCKPIT_TOPICS_WITHOUT_DOCS` below, so nobody
 *   can silently blank an entry that used to point somewhere real.
 * - `apps/website/src/lib/cockpit-docs-links.spec.ts` checks every non-sentinel
 *   value against the Website's actual content tree and nav config. A docs
 *   rename breaks that test rather than the link.
 */

/** Sentinel meaning "this capability has no published docs page yet." */
export const NO_COCKPIT_DOCS_LINK = '';

/**
 * Keyed by `${product}/${section}/${topic}`.
 *
 * The key deliberately omits `language`: the website's documentation is not
 * split by language (it has its own adapter picker), so the Angular and Python
 * lanes of one cockpit demo point at the same page.
 */
export const COCKPIT_DOCS_LINKS: Readonly<Record<string, string>> = {
  // deep-agents
  'deep-agents/getting-started/overview':
    '/docs/angular/deep-agents/getting-started/introduction',
  'deep-agents/core-capabilities/planning':
    '/docs/angular/deep-agents/capabilities/planning',
  'deep-agents/core-capabilities/filesystem':
    '/docs/angular/deep-agents/capabilities/filesystem',
  'deep-agents/core-capabilities/subagents':
    '/docs/angular/deep-agents/capabilities/subagents',
  'deep-agents/core-capabilities/memory':
    '/docs/angular/deep-agents/capabilities/memory',
  'deep-agents/core-capabilities/skills':
    '/docs/angular/deep-agents/capabilities/skills',

  // langgraph
  'langgraph/getting-started/overview':
    '/docs/angular/langgraph/getting-started/introduction',
  'langgraph/core-capabilities/persistence':
    '/docs/angular/langgraph/guides/persistence',
  'langgraph/core-capabilities/durable-execution':
    '/docs/angular/langgraph/guides/durable-execution',
  'langgraph/core-capabilities/streaming': '/docs/angular/langgraph/guides/streaming',
  'langgraph/core-capabilities/interrupts': '/docs/angular/langgraph/guides/interrupts',
  'langgraph/core-capabilities/memory': '/docs/angular/langgraph/guides/memory',
  'langgraph/core-capabilities/subgraphs': '/docs/angular/langgraph/guides/subgraphs',
  'langgraph/core-capabilities/time-travel':
    '/docs/angular/langgraph/guides/time-travel',
  'langgraph/core-capabilities/deployment-runtime':
    '/docs/angular/langgraph/guides/deployment',
  // The demo's visible half is the browser-declared tool, which `chat` documents.
  'langgraph/core-capabilities/client-tools': '/docs/angular/chat/guides/client-tools',

  // AG-UI
  'ag-ui/getting-started/overview': '/docs/angular/ag-ui/getting-started/introduction',
  // AG-UI has no streaming guide; event mapping is where token streaming is specified.
  'ag-ui/core-capabilities/streaming': '/docs/angular/ag-ui/reference/event-mapping',
  'ag-ui/core-capabilities/interrupts': '/docs/angular/ag-ui/guides/interrupts',
  'ag-ui/core-capabilities/tool-views': '/docs/angular/ag-ui/guides/tool-views',
  'ag-ui/core-capabilities/json-render': '/docs/angular/ag-ui/guides/json-render',
  'ag-ui/core-capabilities/client-tools': '/docs/angular/ag-ui/guides/client-tools',
  'ag-ui/core-capabilities/a2ui': '/docs/angular/a2ui/getting-started/introduction',
  'ag-ui/core-capabilities/subagents': '/docs/angular/ag-ui/guides/subagents',

  // render
  'render/getting-started/overview':
    '/docs/angular/render/getting-started/introduction',
  'render/core-capabilities/spec-rendering': '/docs/angular/render/guides/specs',
  'render/core-capabilities/element-rendering':
    '/docs/angular/render/guides/element-rendering',
  'render/core-capabilities/state-management':
    '/docs/angular/render/guides/state-store',
  'render/core-capabilities/registry': '/docs/angular/render/guides/registry',
  'render/core-capabilities/repeat-loops': '/docs/angular/render/guides/repeat-loops',
  // `$computed` resolves against the `functions` map registered by provideRender().
  'render/core-capabilities/computed-functions':
    '/docs/angular/render/guides/computed-functions',

  // chat
  'chat/getting-started/overview': '/docs/angular/chat/getting-started/introduction',
  'chat/core-capabilities/messages': '/docs/angular/chat/concepts/message-model',
  'chat/core-capabilities/input': '/docs/angular/chat/components/chat-input',
  'chat/core-capabilities/interrupts':
    '/docs/angular/chat/components/chat-interrupt-panel',
  'chat/core-capabilities/tool-calls': '/docs/angular/chat/components/chat-tool-calls',
  'chat/core-capabilities/subagents':
    '/docs/angular/chat/components/chat-subagent-card',
  'chat/core-capabilities/threads': '/docs/angular/chat/guides/thread-routing',
  // No chat-timeline page yet; the trace row is the primitive the timeline renders.
  'chat/core-capabilities/timeline': '/docs/angular/chat/components/chat-trace',
  'chat/core-capabilities/generative-ui': '/docs/angular/chat/guides/generative-ui',
  'chat/core-capabilities/debug': '/docs/angular/chat/components/chat-debug',
  'chat/core-capabilities/theming': '/docs/angular/chat/guides/theming',
  'chat/core-capabilities/a2ui': '/docs/angular/chat/a2ui/overview',

  // runtimes
  'runtimes/getting-started/overview':
    '/docs/angular/runtimes/getting-started/introduction',
  'runtimes/core-capabilities/microsoft-agent-framework':
    '/docs/angular/runtimes/microsoft-agent-framework/overview',
  'runtimes/core-capabilities/aws-strands':
    '/docs/angular/runtimes/aws-strands/overview',
  'runtimes/core-capabilities/mastra': '/docs/angular/runtimes/mastra/overview',
};

/**
 * The capabilities that deliberately carry `NO_COCKPIT_DOCS_LINK`.
 *
 * Currently empty: every mapped capability points at a published page. The list
 * stays because the guard spec asserts that the blanked entries are exactly
 * these — so with an empty list, blanking anything at all fails, rather than
 * quietly dropping the "Docs" button from a page.
 */
export const COCKPIT_TOPICS_WITHOUT_DOCS: readonly string[] = [];

/**
 * Resolve the website documentation URL for a cockpit capability.
 *
 * Returns `NO_COCKPIT_DOCS_LINK` for capabilities with no published page, and
 * for any identity missing from the table — an unmapped capability renders no
 * link rather than a guessed one that 404s.
 */
export const getCockpitDocsPath = (
  product: string,
  section: string,
  topic: string
): string =>
  COCKPIT_DOCS_LINKS[`${product}/${section}/${topic}`] ?? NO_COCKPIT_DOCS_LINK;
