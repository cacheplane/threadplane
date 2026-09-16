export type LibraryId =
  | 'langgraph'
  | 'render'
  | 'chat'
  | 'ag-ui'
  | 'a2ui'
  | 'middleware'
  | 'runtimes'
  | 'deep-agents';

export interface DocsPage {
  title: string;
  slug: string;
  section: string;
  /**
   * API pages auto-render the generated `api-docs.json` entry whose name
   * matches the page's H1. Set this on a page that covers a *group* of exports
   * instead — each named entry is rendered in order, below the page prose.
   */
  apiEntries?: string[];
}

export interface DocsSection {
  title: string;
  id: string;
  color: 'blue' | 'red';
  pages: DocsPage[];
}

/**
 * Adapters connect a backend agent runtime; libraries are the companion
 * packages around them. The picker groups on this.
 */
export type LibraryGroup = 'adapter' | 'library';

export interface DocsLibrary {
  id: LibraryId;
  title: string;
  /**
   * Long form. Fallback for the page `<meta name="description">` via
   * {@link resolveDocDescription} — not shown in the picker.
   */
  description: string;
  group: LibraryGroup;
  /**
   * Shown under the name in the library picker. Adapters only — the companion
   * libraries are self-describing, and a tagline there is just noise. Keep to
   * three or four words so picker rows cannot wrap.
   */
  tagline?: string;
  /** Optional external live-demo URL, surfaced contextually in docs nav. */
  demoUrl?: string;
  /** Optional label override for the demo link. Defaults to 'Live demo'. */
  demoLabel?: string;
  sections: DocsSection[];
}

export interface SpecialDocsPage {
  path: string;
  contentPath: string;
  title: string;
  description: string;
}

export const specialDocsPages: SpecialDocsPage[] = [
  {
    path: '/docs/choosing-an-adapter',
    contentPath: 'choosing-an-adapter/index.mdx',
    title: 'Choosing an adapter',
    description:
      'Decide between @threadplane/langgraph and @threadplane/ag-ui for your Angular agent UI.',
  },
];

export const docsConfig: DocsLibrary[] = [
  {
    id: 'langgraph',
    title: 'LangGraph',
    description: 'LangChain/LangGraph adapter for Angular UI',
    group: 'adapter',
    tagline: 'Talk to LangGraph directly',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          {
            title: 'Introduction',
            slug: 'introduction',
            section: 'getting-started',
          },
          {
            title: 'Quick Start',
            slug: 'quickstart',
            section: 'getting-started',
          },
          {
            title: 'Installation',
            slug: 'installation',
            section: 'getting-started',
          },
        ],
      },
      {
        title: 'Guides',
        id: 'guides',
        color: 'blue',
        pages: [
          { title: 'Streaming', slug: 'streaming', section: 'guides' },
          { title: 'Persistence', slug: 'persistence', section: 'guides' },
          {
            title: 'Durable Execution',
            slug: 'durable-execution',
            section: 'guides',
          },
          { title: 'Interrupts', slug: 'interrupts', section: 'guides' },
          { title: 'Memory', slug: 'memory', section: 'guides' },
          { title: 'Time Travel', slug: 'time-travel', section: 'guides' },
          { title: 'Subgraphs', slug: 'subgraphs', section: 'guides' },
          { title: 'Testing', slug: 'testing', section: 'guides' },
          { title: 'Deployment', slug: 'deployment', section: 'guides' },
          { title: 'Lifecycle Signals', slug: 'lifecycle', section: 'guides' },
        ],
      },
      {
        title: 'Concepts',
        id: 'concepts',
        color: 'red',
        pages: [
          {
            title: 'Agent Contract',
            slug: 'agent-contract',
            section: 'concepts',
          },
          {
            title: 'Angular Signals',
            slug: 'angular-signals',
            section: 'concepts',
          },
          {
            title: 'LangGraph Basics',
            slug: 'langgraph-basics',
            section: 'concepts',
          },
          {
            title: 'Agent Architecture',
            slug: 'agent-architecture',
            section: 'concepts',
          },
          {
            title: 'State Management',
            slug: 'state-management',
            section: 'concepts',
          },
        ],
      },
      {
        title: 'API Reference',
        id: 'api',
        color: 'blue',
        pages: [
          { title: 'injectAgent()', slug: 'inject-agent', section: 'api' },
          { title: 'provideAgent()', slug: 'provide-agent', section: 'api' },
          {
            title: 'FetchStreamTransport',
            slug: 'fetch-stream-transport',
            section: 'api',
          },
          {
            title: 'MockAgentTransport',
            slug: 'mock-stream-transport',
            section: 'api',
          },
          {
            title: 'LangGraphThreadsAdapter',
            slug: 'langgraph-threads-adapter',
            section: 'api',
          },
        ],
      },
    ],
  },
  {
    id: 'render',
    // Display label only. The package is @threadplane/render and the docs URL
    // stays /docs/render/ — but every page of prose calls it json-render.
    title: 'json-render',
    description: 'Declarative UI rendering from JSON specifications',
    group: 'library',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          {
            title: 'Introduction',
            slug: 'introduction',
            section: 'getting-started',
          },
          {
            title: 'Quick Start',
            slug: 'quickstart',
            section: 'getting-started',
          },
          {
            title: 'Installation',
            slug: 'installation',
            section: 'getting-started',
          },
        ],
      },
      {
        title: 'Guides',
        id: 'guides',
        color: 'blue',
        pages: [
          { title: 'Component Registry', slug: 'registry', section: 'guides' },
          { title: 'State Store', slug: 'state-store', section: 'guides' },
          { title: 'Specs & Elements', slug: 'specs', section: 'guides' },
          { title: 'Repeat Loops', slug: 'repeat-loops', section: 'guides' },
          { title: 'Events & Handlers', slug: 'events', section: 'guides' },
          { title: 'Lifecycle Signals', slug: 'lifecycle', section: 'guides' },
        ],
      },
      {
        title: 'Concepts',
        id: 'concepts',
        color: 'red',
        pages: [
          {
            title: 'JSON Render vs A2UI',
            slug: 'json-render-vs-a2ui',
            section: 'concepts',
          },
        ],
      },
      {
        title: 'API Reference',
        id: 'api',
        color: 'blue',
        pages: [
          {
            title: 'RenderSpecComponent',
            slug: 'render-spec-component',
            section: 'api',
          },
          {
            title: 'defineAngularRegistry()',
            slug: 'define-angular-registry',
            section: 'api',
          },
          { title: 'views()', slug: 'views', section: 'api' },
          {
            title: 'signalStateStore()',
            slug: 'signal-state-store',
            section: 'api',
          },
          { title: 'provideRender()', slug: 'provide-render', section: 'api' },
        ],
      },
    ],
  },
  {
    id: 'chat',
    title: 'Chat',
    description: 'Pre-built chat UI components for agent interfaces',
    group: 'library',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          { title: 'Introduction', slug: 'introduction', section: 'getting-started' },
          { title: 'Quick Start', slug: 'quickstart', section: 'getting-started' },
          { title: 'Try without a backend', slug: 'try-without-a-backend', section: 'getting-started' },
          { title: 'Coding agents', slug: 'coding-agents', section: 'getting-started' },
          { title: 'Installation', slug: 'installation', section: 'getting-started' },
          { title: 'Changelog', slug: 'changelog', section: 'getting-started' },
        ],
      },
      {
        title: 'Guides',
        id: 'guides',
        color: 'blue',
        pages: [
          { title: 'Layout Modes', slug: 'layout-modes', section: 'guides' },
          { title: 'Theming', slug: 'theming', section: 'guides' },
          { title: 'Markdown Rendering', slug: 'markdown', section: 'guides' },
          { title: 'Generative UI', slug: 'generative-ui', section: 'guides' },
          { title: 'Client Tools', slug: 'client-tools', section: 'guides' },
          {
            title: 'Custom A2UI Catalogs',
            slug: 'custom-catalogs',
            section: 'guides',
          },
          { title: 'Streaming', slug: 'streaming', section: 'guides' },
          {
            title: 'Error Handling',
            slug: 'error-handling',
            section: 'guides',
          },
          {
            title: 'Writing an Adapter',
            slug: 'writing-an-adapter',
            section: 'guides',
          },
          {
            title: 'Thread Routing',
            slug: 'thread-routing',
            section: 'guides',
          },
          { title: 'Lifecycle Signals', slug: 'lifecycle', section: 'guides' },
        ],
      },
      {
        title: 'Concepts',
        id: 'concepts',
        color: 'red',
        pages: [
          {
            title: 'Primitives vs Compositions',
            slug: 'primitives-vs-compositions',
            section: 'concepts',
          },
          {
            title: 'Message Model',
            slug: 'message-model',
            section: 'concepts',
          },
        ],
      },
      {
        title: 'Components',
        id: 'components',
        color: 'red',
        pages: [
          { title: 'ChatComponent', slug: 'chat', section: 'components' },
          { title: 'ChatPopup', slug: 'chat-popup', section: 'components' },
          { title: 'ChatSidebar', slug: 'chat-sidebar', section: 'components' },
          { title: 'ChatSidenav', slug: 'chat-sidenav', section: 'components' },
          {
            title: 'ChatMessageList',
            slug: 'chat-message-list',
            section: 'components',
          },
          { title: 'ChatTrace', slug: 'chat-trace', section: 'components' },
          { title: 'ChatInput', slug: 'chat-input', section: 'components' },
          {
            title: 'ChatReasoning',
            slug: 'chat-reasoning',
            section: 'components',
          },
          {
            title: 'ChatInterruptPanel',
            slug: 'chat-interrupt-panel',
            section: 'components',
          },
          {
            title: 'ChatToolCalls',
            slug: 'chat-tool-calls',
            section: 'components',
          },
          {
            title: 'chatToolCallTemplate',
            slug: 'chat-tool-call-template',
            section: 'components',
          },
          {
            title: 'ChatToolCallCard',
            slug: 'chat-tool-call-card',
            section: 'components',
          },
          {
            title: 'ChatSubagentCard',
            slug: 'chat-subagent-card',
            section: 'components',
          },
          { title: 'ChatDebug', slug: 'chat-debug', section: 'components' },
          { title: 'ChatSelect', slug: 'chat-select', section: 'components' },
        ],
      },
      {
        title: 'A2UI',
        id: 'a2ui',
        color: 'red',
        pages: [
          { title: 'Overview', slug: 'overview', section: 'a2ui' },
          {
            title: 'A2uiSurfaceComponent',
            slug: 'surface-component',
            section: 'a2ui',
          },
          {
            title: 'createA2uiSurfaceStore()',
            slug: 'surface-store',
            section: 'a2ui',
          },
          { title: 'Component Catalog', slug: 'catalog', section: 'a2ui' },
        ],
      },
      {
        title: 'API Reference',
        id: 'api',
        color: 'blue',
        pages: [
          { title: 'mockAgent()', slug: 'mock-agent', section: 'api' },
          {
            title: 'createContentClassifier()',
            slug: 'content-classifier',
            section: 'api',
          },
          {
            title: 'createParseTreeStore()',
            slug: 'parse-tree-store',
            section: 'api',
          },
        ],
      },
    ],
  },
  {
    id: 'ag-ui',
    title: 'AG-UI',
    description:
      'Adapter for AG-UI-compatible backends including CrewAI, Mastra, Microsoft AF, AG2, Pydantic AI, and AWS Strands',
    group: 'adapter',
    tagline: 'Any AG-UI backend',
    demoUrl: 'https://ag-ui.threadplane.ai',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          {
            title: 'Introduction',
            slug: 'introduction',
            section: 'getting-started',
          },
          {
            title: 'Quick Start',
            slug: 'quickstart',
            section: 'getting-started',
          },
          {
            title: 'Installation',
            slug: 'installation',
            section: 'getting-started',
          },
        ],
      },
      {
        title: 'Concepts',
        id: 'concepts',
        color: 'red',
        pages: [
          { title: 'Architecture', slug: 'architecture', section: 'concepts' },
        ],
      },
      {
        title: 'Guides',
        id: 'guides',
        color: 'blue',
        pages: [
          { title: 'Fake Agent', slug: 'fake-agent', section: 'guides' },
          { title: 'Citations', slug: 'citations', section: 'guides' },
          { title: 'Custom Events', slug: 'custom-events', section: 'guides' },
          { title: 'Interrupts', slug: 'interrupts', section: 'guides' },
          { title: 'Client Tools', slug: 'client-tools', section: 'guides' },
          { title: 'Tool Views', slug: 'tool-views', section: 'guides' },
          { title: 'Generative UI', slug: 'json-render', section: 'guides' },
          { title: 'Subagents', slug: 'subagents', section: 'guides' },
          { title: 'Testing', slug: 'testing', section: 'guides' },
          { title: 'Deployment', slug: 'deployment', section: 'guides' },
          {
            title: 'Troubleshooting',
            slug: 'troubleshooting',
            section: 'guides',
          },
        ],
      },
      {
        title: 'Reference',
        id: 'reference',
        color: 'blue',
        pages: [
          {
            title: 'Event Mapping',
            slug: 'event-mapping',
            section: 'reference',
          },
        ],
      },
      {
        title: 'API Reference',
        id: 'api',
        color: 'blue',
        pages: [
          { title: 'provideAgent()', slug: 'provide-agent', section: 'api' },
          { title: 'injectAgent()', slug: 'inject-agent', section: 'api' },
          { title: 'toAgent()', slug: 'to-agent', section: 'api' },
          { title: 'FakeAgent', slug: 'fake-agent', section: 'api' },
        ],
      },
    ],
  },
  {
    id: 'a2ui',
    title: 'A2UI',
    description: 'Protocol types and helpers for agent-driven UI surfaces',
    group: 'library',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          {
            title: 'Introduction',
            slug: 'introduction',
            section: 'getting-started',
          },
          {
            title: 'Quick Start',
            slug: 'quickstart',
            section: 'getting-started',
          },
        ],
      },
      {
        title: 'Guides',
        id: 'guides',
        color: 'blue',
        pages: [
          {
            title: 'Message Protocol',
            slug: 'message-protocol',
            section: 'guides',
          },
          { title: 'Data Model', slug: 'data-model', section: 'guides' },
          {
            title: 'Validating & Adapting',
            slug: 'adapters-and-validation',
            section: 'guides',
          },
        ],
      },
      {
        title: 'Reference',
        id: 'reference',
        color: 'blue',
        pages: [
          { title: 'Schema', slug: 'schema', section: 'reference' },
          {
            title: 'Parser, Resolver, and Guards',
            slug: 'parser-resolver-guards',
            section: 'reference',
          },
        ],
      },
    ],
  },
  {
    id: 'middleware',
    title: 'Middleware',
    description: 'Backend helpers for browser-executed client tools',
    group: 'library',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          {
            title: 'Introduction',
            slug: 'introduction',
            section: 'getting-started',
          },
          {
            title: 'Quick Start',
            slug: 'quickstart',
            section: 'getting-started',
          },
        ],
      },
      {
        title: 'Guides',
        id: 'guides',
        color: 'blue',
        pages: [
          {
            title: 'LangGraph.js Client Tools',
            slug: 'langgraph-client-tools',
            section: 'guides',
          },
          {
            title: 'Python LangGraph Middleware',
            slug: 'python-langgraph',
            section: 'guides',
          },
        ],
      },
      {
        title: 'API Reference',
        id: 'api',
        color: 'blue',
        pages: [
          {
            title: 'LangGraph.js Helpers',
            slug: 'client-tool-helpers',
            section: 'api',
            apiEntries: [
              'bindClientTools',
              'clientToolsChannel',
              'clientToolsRouter',
              'clientToolSpecs',
              'clientToolNames',
              'hasClientToolCall',
              'hasServerToolCall',
              'routeAfterAgent',
              'lastMessage',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'runtimes',
    title: 'Runtimes',
    description:
      'Measured AG-UI runtime integrations behind @threadplane/ag-ui',
    // Reference material *behind* the AG-UI adapter, not an adapter you pick.
    group: 'library',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          {
            title: 'Introduction',
            slug: 'introduction',
            section: 'getting-started',
          },
        ],
      },
      {
        title: 'AWS Strands',
        id: 'aws-strands',
        color: 'blue',
        pages: [
          { title: 'Overview', slug: 'overview', section: 'aws-strands' },
          { title: 'Quickstart', slug: 'quickstart', section: 'aws-strands' },
          {
            title: 'How It Connects',
            slug: 'how-it-connects',
            section: 'aws-strands',
          },
        ],
      },
      {
        title: 'Microsoft Agent Framework',
        id: 'microsoft-agent-framework',
        color: 'red',
        pages: [
          {
            title: 'Overview',
            slug: 'overview',
            section: 'microsoft-agent-framework',
          },
          {
            title: 'Quickstart',
            slug: 'quickstart',
            section: 'microsoft-agent-framework',
          },
          {
            title: 'How It Connects',
            slug: 'how-it-connects',
            section: 'microsoft-agent-framework',
          },
        ],
      },
      {
        title: 'Mastra',
        id: 'mastra',
        color: 'blue',
        pages: [
          { title: 'Overview', slug: 'overview', section: 'mastra' },
          { title: 'Quickstart', slug: 'quickstart', section: 'mastra' },
          {
            title: 'How It Connects',
            slug: 'how-it-connects',
            section: 'mastra',
          },
        ],
      },
    ],
  },
  {
    id: 'deep-agents',
    title: 'Deep Agents',
    description:
      'Rendering the Deep Agents middleware capabilities — planning, filesystem, subagents, memory, and skills — in an Angular UI',
    // The framework is a LangGraph agent harness, so these pages sit behind the
    // LangGraph adapter rather than beside it. Reference material, not a pick.
    group: 'library',
    sections: [
      {
        title: 'Getting Started',
        id: 'getting-started',
        color: 'blue',
        pages: [
          {
            title: 'Introduction',
            slug: 'introduction',
            section: 'getting-started',
          },
        ],
      },
      {
        title: 'Capabilities',
        id: 'capabilities',
        color: 'blue',
        pages: [
          { title: 'Planning', slug: 'planning', section: 'capabilities' },
          { title: 'Filesystem', slug: 'filesystem', section: 'capabilities' },
          { title: 'Subagents', slug: 'subagents', section: 'capabilities' },
          { title: 'Memory', slug: 'memory', section: 'capabilities' },
          { title: 'Skills', slug: 'skills', section: 'capabilities' },
        ],
      },
    ],
  },
];

export function getLibraryConfig(libraryId: string): DocsLibrary | undefined {
  return docsConfig.find((l) => l.id === libraryId);
}

/**
 * Where a library's breadcrumb rung points.
 *
 * There is no `/docs/<library>` index route, so the rung links the library's
 * introduction page instead. Both the shell header's `contextTrail` and the
 * BreadcrumbList structured data on the same page call this, because Google
 * expects the markup to match what the user sees — deriving both from one
 * function is what makes that true by construction rather than by comment.
 */
export function libraryIntroPath(library: string): string {
  return `/docs/${library}/getting-started/introduction`;
}

export function getLibraryPages(libraryId: string): DocsPage[] {
  const lib = getLibraryConfig(libraryId);
  if (!lib) return [];
  return lib.sections.flatMap((s) => s.pages);
}

export const allDocsPages: DocsPage[] = docsConfig.flatMap((l) =>
  l.sections.flatMap((s) => s.pages)
);

export function findDocsPage(
  library: string,
  section: string,
  slug: string
): DocsPage | undefined {
  return getLibraryPages(library).find(
    (p) => p.section === section && p.slug === slug
  );
}

export function getPrevNextPages(
  library: string,
  section: string,
  slug: string
): { prev: DocsPage | null; next: DocsPage | null } {
  const pages = getLibraryPages(library);
  const idx = pages.findIndex((p) => p.section === section && p.slug === slug);
  return {
    prev: idx > 0 ? pages[idx - 1] : null,
    next: idx < pages.length - 1 ? pages[idx + 1] : null,
  };
}

export function getDocsSection(
  library: string,
  sectionId: string
): DocsSection | undefined {
  const lib = getLibraryConfig(library);
  return lib?.sections.find((s) => s.id === sectionId);
}
