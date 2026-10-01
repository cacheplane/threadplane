import type {
  CockpitFrontend,
  CockpitManifestIdentity,
  RuntimeAdapter,
  WorkspaceMode,
} from './manifest.types';
import { getCockpitFrontends } from './capability-registry';

/** Serializable capability content owned by the Cockpit registry. */
export interface RegisteredCapabilityModule {
  readonly id: string;
  /** Legacy descriptors omit this field and resolve as Angular. */
  readonly frontend?: CockpitFrontend;
  readonly runtimeAdapter: RuntimeAdapter;
  readonly manifestIdentity: {
    readonly product: string;
    readonly section: string;
    readonly topic: string;
    readonly page: string;
    readonly language: string;
  };
  readonly title: string;
  readonly docsPath: string;
  readonly promptAssetPaths: readonly string[];
  readonly codeAssetPaths: readonly string[];
  readonly backendAssetPaths?: readonly string[];
  readonly runtimeUrl?: string;
  readonly devPort?: number;
}

const capabilityModuleData: RegisteredCapabilityModule[] = [
  {
    id: 'langgraph-streaming-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'streaming',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Streaming (Python)',
    docsPath: '/docs/langgraph/guides/streaming',
    promptAssetPaths: [
      'cockpit/langgraph/streaming/python/prompts/streaming.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
      'cockpit/langgraph/streaming/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/langgraph/streaming/python/src/graph.py'],
    runtimeUrl: 'langgraph/streaming',
    devPort: 4300,
  },
  {
    id: 'langgraph-persistence-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'persistence',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Persistence (Python)',
    docsPath: '/docs/langgraph/guides/persistence',
    promptAssetPaths: [
      'cockpit/langgraph/persistence/python/prompts/persistence.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/persistence/angular/src/app/persistence.component.ts',
      'cockpit/langgraph/persistence/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/langgraph/persistence/python/src/graph.py'],
    runtimeUrl: 'langgraph/persistence',
    devPort: 4301,
  },
  {
    id: 'langgraph-interrupts-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'interrupts',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Interrupts (Python)',
    docsPath: '/docs/langgraph/guides/interrupts',
    promptAssetPaths: [
      'cockpit/langgraph/interrupts/python/prompts/interrupts.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/interrupts/angular/src/app/interrupts.component.ts',
      'cockpit/langgraph/interrupts/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/langgraph/interrupts/python/src/graph.py'],
    runtimeUrl: 'langgraph/interrupts',
    devPort: 4302,
  },
  {
    id: 'langgraph-memory-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'memory',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Memory (Python)',
    docsPath: '/docs/langgraph/guides/memory',
    promptAssetPaths: ['cockpit/langgraph/memory/python/prompts/memory.md'],
    codeAssetPaths: [
      'cockpit/langgraph/memory/angular/src/app/memory.component.ts',
      'cockpit/langgraph/memory/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/langgraph/memory/python/src/graph.py'],
    runtimeUrl: 'langgraph/memory',
    devPort: 4303,
  },
  {
    id: 'langgraph-durable-execution-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'durable-execution',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Durable Execution (Python)',
    docsPath: '/docs/langgraph/guides/durable-execution',
    promptAssetPaths: [
      'cockpit/langgraph/durable-execution/python/prompts/durable-execution.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/durable-execution/angular/src/app/durable-execution.component.ts',
      'cockpit/langgraph/durable-execution/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/langgraph/durable-execution/python/src/graph.py',
    ],
    runtimeUrl: 'langgraph/durable-execution',
    devPort: 4304,
  },
  {
    id: 'langgraph-subgraphs-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'subgraphs',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Subgraphs (Python)',
    docsPath: '/docs/langgraph/guides/subgraphs',
    promptAssetPaths: [
      'cockpit/langgraph/subgraphs/python/prompts/subgraphs.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/subgraphs/angular/src/app/agent-ref.ts',
      'cockpit/langgraph/subgraphs/angular/src/app/subgraphs.component.ts',
    ],
    backendAssetPaths: ['cockpit/langgraph/subgraphs/python/src/graph.py'],
    runtimeUrl: 'langgraph/subgraphs',
    devPort: 4305,
  },
  {
    id: 'langgraph-time-travel-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'time-travel',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Time Travel (Python)',
    docsPath: '/docs/langgraph/guides/time-travel',
    promptAssetPaths: [
      'cockpit/langgraph/time-travel/python/prompts/time-travel.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/time-travel/angular/src/app/time-travel.component.ts',
      'cockpit/langgraph/time-travel/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/langgraph/time-travel/python/src/graph.py'],
    runtimeUrl: 'langgraph/time-travel',
    devPort: 4306,
  },
  {
    id: 'langgraph-deployment-runtime-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'deployment-runtime',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Deployment Runtime (Python)',
    docsPath: '/docs/langgraph/guides/deployment',
    promptAssetPaths: [
      'cockpit/langgraph/deployment-runtime/python/prompts/deployment-runtime.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/deployment-runtime/angular/src/app/deployment-runtime.component.ts',
      'cockpit/langgraph/deployment-runtime/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/langgraph/deployment-runtime/python/src/graph.py',
    ],
    runtimeUrl: 'langgraph/deployment-runtime',
    devPort: 4307,
  },
  {
    id: 'langgraph-client-tools-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'client-tools',
      page: 'overview',
      language: 'python',
    },
    title: 'LangGraph Client Tools (Python)',
    docsPath: '/docs/chat/guides/client-tools',
    promptAssetPaths: [
      'cockpit/langgraph/client-tools/python/prompts/client-tools.md',
    ],
    codeAssetPaths: [
      'cockpit/langgraph/client-tools/angular/src/app/client-tools.component.ts',
      'cockpit/langgraph/client-tools/angular/src/app/weather-card.component.ts',
      'cockpit/langgraph/client-tools/angular/src/app/confirm-booking.component.ts',
      'cockpit/langgraph/client-tools/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/langgraph/client-tools/python/src/graph.py'],
    runtimeUrl: 'langgraph/client-tools',
    devPort: 4308,
  },
  {
    id: 'ag-ui-interrupts-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'ag-ui',
      section: 'core-capabilities',
      topic: 'interrupts',
      page: 'overview',
      language: 'python',
    },
    title: 'AG-UI Interrupts (Python)',
    docsPath: '/docs/ag-ui/guides/interrupts',
    promptAssetPaths: ['cockpit/ag-ui/interrupts/python/prompts/interrupts.md'],
    codeAssetPaths: [
      'cockpit/ag-ui/interrupts/angular/src/app/interrupts.component.ts',
      'cockpit/ag-ui/interrupts/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/ag-ui/interrupts/python/src/graph.py',
      'cockpit/ag-ui/interrupts/python/src/server.py',
    ],
    runtimeUrl: 'ag-ui/interrupts',
    devPort: 4320,
  },
  {
    id: 'ag-ui-streaming-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'ag-ui',
      section: 'core-capabilities',
      topic: 'streaming',
      page: 'overview',
      language: 'python',
    },
    title: 'AG-UI Streaming (Python)',
    docsPath: '/docs/ag-ui/reference/event-mapping',
    promptAssetPaths: ['cockpit/ag-ui/streaming/python/prompts/streaming.md'],
    codeAssetPaths: [
      'cockpit/ag-ui/streaming/angular/src/app/streaming.component.ts',
      'cockpit/ag-ui/streaming/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/ag-ui/streaming/python/src/graph.py',
      'cockpit/ag-ui/streaming/python/src/server.py',
    ],
    runtimeUrl: 'ag-ui/streaming',
    devPort: 4321,
  },
  {
    id: 'ag-ui-tool-views-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'ag-ui',
      section: 'core-capabilities',
      topic: 'tool-views',
      page: 'overview',
      language: 'python',
    },
    title: 'AG-UI Tool Views (Python)',
    docsPath: '/docs/ag-ui/guides/tool-views',
    promptAssetPaths: ['cockpit/ag-ui/tool-views/python/prompts/tool-views.md'],
    codeAssetPaths: [
      'cockpit/ag-ui/tool-views/angular/src/app/tool-views.component.ts',
      'cockpit/ag-ui/tool-views/angular/src/app/weather-card.component.ts',
      'cockpit/ag-ui/tool-views/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/ag-ui/tool-views/python/src/graph.py',
      'cockpit/ag-ui/tool-views/python/src/server.py',
    ],
    runtimeUrl: 'ag-ui/tool-views',
    devPort: 4322,
  },
  {
    id: 'ag-ui-json-render-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'ag-ui',
      section: 'core-capabilities',
      topic: 'json-render',
      page: 'overview',
      language: 'python',
    },
    title: 'AG-UI JSON Render (Python)',
    docsPath: '/docs/ag-ui/guides/json-render',
    promptAssetPaths: [
      'cockpit/ag-ui/json-render/python/prompts/json-render.md',
    ],
    codeAssetPaths: [
      'cockpit/ag-ui/json-render/angular/src/app/json-render.component.ts',
      'cockpit/ag-ui/json-render/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/ag-ui/json-render/python/src/graph.py',
      'cockpit/ag-ui/json-render/python/src/server.py',
    ],
    runtimeUrl: 'ag-ui/json-render',
    devPort: 4323,
  },
  {
    id: 'ag-ui-client-tools-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'ag-ui',
      section: 'core-capabilities',
      topic: 'client-tools',
      page: 'overview',
      language: 'python',
    },
    title: 'AG-UI Client Tools (Python)',
    docsPath: '/docs/ag-ui/guides/client-tools',
    promptAssetPaths: [
      'cockpit/ag-ui/client-tools/python/prompts/client-tools.md',
    ],
    codeAssetPaths: [
      'cockpit/ag-ui/client-tools/angular/src/app/client-tools.component.ts',
      'cockpit/ag-ui/client-tools/angular/src/app/weather-card.component.ts',
      'cockpit/ag-ui/client-tools/angular/src/app/confirm-booking.component.ts',
      'cockpit/ag-ui/client-tools/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/ag-ui/client-tools/python/src/graph.py',
      'cockpit/ag-ui/client-tools/python/src/server.py',
    ],
    runtimeUrl: 'ag-ui/client-tools',
    devPort: 4325,
  },
  {
    id: 'ag-ui-a2ui-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'ag-ui',
      section: 'core-capabilities',
      topic: 'a2ui',
      page: 'overview',
      language: 'python',
    },
    title: 'AG-UI A2UI (Python)',
    docsPath: '/docs/a2ui/getting-started/introduction',
    promptAssetPaths: ['cockpit/ag-ui/a2ui/python/prompts/a2ui.md'],
    codeAssetPaths: [
      'cockpit/ag-ui/a2ui/angular/src/app/a2ui.component.ts',
      'cockpit/ag-ui/a2ui/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/ag-ui/a2ui/python/src/graph.py',
      'cockpit/ag-ui/a2ui/python/src/server.py',
    ],
    runtimeUrl: 'ag-ui/a2ui',
    devPort: 4324,
  },
  {
    id: 'ag-ui-subagents-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'ag-ui',
      section: 'core-capabilities',
      topic: 'subagents',
      page: 'overview',
      language: 'python',
    },
    title: 'AG-UI Subagents (Python)',
    docsPath: '/docs/ag-ui/guides/subagents',
    promptAssetPaths: ['cockpit/ag-ui/subagents/python/prompts/subagents.md'],
    codeAssetPaths: [
      'cockpit/ag-ui/subagents/angular/src/app/subagents.component.ts',
      'cockpit/ag-ui/subagents/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/ag-ui/subagents/python/src/graph.py',
      'cockpit/ag-ui/subagents/python/src/server.py',
    ],
    runtimeUrl: 'ag-ui/subagents',
    devPort: 4326,
  },
  {
    id: 'deep-agents-memory-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'deep-agents',
      section: 'core-capabilities',
      topic: 'memory',
      page: 'overview',
      language: 'python',
    },
    title: 'Deep Agents Memory (Python)',
    docsPath: '/docs/deep-agents/capabilities/memory',
    promptAssetPaths: ['cockpit/deep-agents/memory/python/prompts/memory.md'],
    codeAssetPaths: [
      'cockpit/deep-agents/memory/angular/src/app/memory.component.ts',
      'cockpit/deep-agents/memory/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/deep-agents/memory/python/src/graph.py'],
    runtimeUrl: 'deep-agents/memory',
    devPort: 4313,
  },
  {
    id: 'deep-agents-planning-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'deep-agents',
      section: 'core-capabilities',
      topic: 'planning',
      page: 'overview',
      language: 'python',
    },
    title: 'Deep Agents Planning (Python)',
    docsPath: '/docs/deep-agents/capabilities/planning',
    promptAssetPaths: [
      'cockpit/deep-agents/planning/python/prompts/planning.md',
    ],
    codeAssetPaths: [
      'cockpit/deep-agents/planning/angular/src/app/planning.component.ts',
      'cockpit/deep-agents/planning/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/deep-agents/planning/python/src/graph.py'],
    runtimeUrl: 'deep-agents/planning',
    devPort: 4310,
  },
  {
    id: 'deep-agents-filesystem-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'deep-agents',
      section: 'core-capabilities',
      topic: 'filesystem',
      page: 'overview',
      language: 'python',
    },
    title: 'Deep Agents Filesystem (Python)',
    docsPath: '/docs/deep-agents/capabilities/filesystem',
    promptAssetPaths: [
      'cockpit/deep-agents/filesystem/python/prompts/filesystem.md',
    ],
    codeAssetPaths: [
      'cockpit/deep-agents/filesystem/angular/src/app/filesystem.component.ts',
      'cockpit/deep-agents/filesystem/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/deep-agents/filesystem/python/src/graph.py'],
    runtimeUrl: 'deep-agents/filesystem',
    devPort: 4311,
  },
  {
    id: 'deep-agents-subagents-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'deep-agents',
      section: 'core-capabilities',
      topic: 'subagents',
      page: 'overview',
      language: 'python',
    },
    title: 'Deep Agents Subagents (Python)',
    docsPath: '/docs/deep-agents/capabilities/subagents',
    promptAssetPaths: [
      'cockpit/deep-agents/subagents/python/prompts/subagents.md',
    ],
    codeAssetPaths: [
      'cockpit/deep-agents/subagents/angular/src/app/subagents.component.ts',
      'cockpit/deep-agents/subagents/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/deep-agents/subagents/python/src/graph.py'],
    runtimeUrl: 'deep-agents/subagents',
    devPort: 4312,
  },
  {
    id: 'deep-agents-skills-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'deep-agents',
      section: 'core-capabilities',
      topic: 'skills',
      page: 'overview',
      language: 'python',
    },
    title: 'Deep Agents Skills (Python)',
    docsPath: '/docs/deep-agents/capabilities/skills',
    promptAssetPaths: ['cockpit/deep-agents/skills/python/prompts/skills.md'],
    codeAssetPaths: [
      'cockpit/deep-agents/skills/angular/src/app/skills.component.ts',
      'cockpit/deep-agents/skills/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/deep-agents/skills/python/src/graph.py'],
    runtimeUrl: 'deep-agents/skills',
    devPort: 4314,
  },
  {
    id: 'render-spec-rendering-python',
    runtimeAdapter: 'none',
    manifestIdentity: {
      product: 'render',
      section: 'core-capabilities',
      topic: 'spec-rendering',
      page: 'overview',
      language: 'python',
    },
    title: 'Render Spec Rendering (Python)',
    docsPath: '/docs/render/guides/specs',
    promptAssetPaths: [
      'cockpit/render/spec-rendering/python/prompts/spec-rendering.md',
    ],
    codeAssetPaths: [
      'cockpit/render/spec-rendering/angular/src/app/spec-rendering.component.ts',
      'cockpit/render/spec-rendering/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/render/spec-rendering/python/src/graph.py'],
    runtimeUrl: 'render/spec-rendering',
    devPort: 4401,
  },
  {
    id: 'render-element-rendering-python',
    runtimeAdapter: 'none',
    manifestIdentity: {
      product: 'render',
      section: 'core-capabilities',
      topic: 'element-rendering',
      page: 'overview',
      language: 'python',
    },
    title: 'Render Element Rendering (Python)',
    docsPath: '/docs/render/api/render-spec-component',
    promptAssetPaths: [
      'cockpit/render/element-rendering/python/prompts/element-rendering.md',
    ],
    codeAssetPaths: [
      'cockpit/render/element-rendering/angular/src/app/element-rendering.component.ts',
      'cockpit/render/element-rendering/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/render/element-rendering/python/src/graph.py'],
    runtimeUrl: 'render/element-rendering',
    devPort: 4402,
  },
  {
    id: 'render-state-management-python',
    runtimeAdapter: 'none',
    manifestIdentity: {
      product: 'render',
      section: 'core-capabilities',
      topic: 'state-management',
      page: 'overview',
      language: 'python',
    },
    title: 'Render State Management (Python)',
    docsPath: '/docs/render/guides/state-store',
    promptAssetPaths: [
      'cockpit/render/state-management/python/prompts/state-management.md',
    ],
    codeAssetPaths: [
      'cockpit/render/state-management/angular/src/app/state-management.component.ts',
      'cockpit/render/state-management/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/render/state-management/python/src/graph.py'],
    runtimeUrl: 'render/state-management',
    devPort: 4403,
  },
  {
    id: 'render-registry-python',
    runtimeAdapter: 'none',
    manifestIdentity: {
      product: 'render',
      section: 'core-capabilities',
      topic: 'registry',
      page: 'overview',
      language: 'python',
    },
    title: 'Render Registry (Python)',
    docsPath: '/docs/render/guides/registry',
    promptAssetPaths: ['cockpit/render/registry/python/prompts/registry.md'],
    codeAssetPaths: [
      'cockpit/render/registry/angular/src/app/registry.component.ts',
      'cockpit/render/registry/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/render/registry/python/src/graph.py'],
    runtimeUrl: 'render/registry',
    devPort: 4404,
  },
  {
    id: 'render-repeat-loops-python',
    runtimeAdapter: 'none',
    manifestIdentity: {
      product: 'render',
      section: 'core-capabilities',
      topic: 'repeat-loops',
      page: 'overview',
      language: 'python',
    },
    title: 'Render Repeat Loops (Python)',
    docsPath: '/docs/render/guides/repeat-loops',
    promptAssetPaths: [
      'cockpit/render/repeat-loops/python/prompts/repeat-loops.md',
    ],
    codeAssetPaths: [
      'cockpit/render/repeat-loops/angular/src/app/repeat-loops.component.ts',
      'cockpit/render/repeat-loops/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/render/repeat-loops/python/src/graph.py'],
    runtimeUrl: 'render/repeat-loops',
    devPort: 4405,
  },
  {
    id: 'render-computed-functions-python',
    runtimeAdapter: 'none',
    manifestIdentity: {
      product: 'render',
      section: 'core-capabilities',
      topic: 'computed-functions',
      page: 'overview',
      language: 'python',
    },
    title: 'Render Computed Functions (Python)',
    docsPath: '/docs/render/api/provide-render',
    promptAssetPaths: [
      'cockpit/render/computed-functions/python/prompts/computed-functions.md',
    ],
    codeAssetPaths: [
      'cockpit/render/computed-functions/angular/src/app/computed-functions.component.ts',
      'cockpit/render/computed-functions/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/render/computed-functions/python/src/graph.py',
    ],
    runtimeUrl: 'render/computed-functions',
    devPort: 4406,
  },
  {
    id: 'chat-messages-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'messages',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Messages (Python)',
    docsPath: '/docs/chat/concepts/message-model',
    promptAssetPaths: ['cockpit/chat/messages/python/prompts/messages.md'],
    codeAssetPaths: [
      'cockpit/chat/messages/angular/src/app/messages.component.ts',
      'cockpit/chat/messages/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/messages/python/src/graph.py'],
    runtimeUrl: 'chat/messages',
    devPort: 4501,
  },
  {
    id: 'chat-input-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'input',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Input (Python)',
    docsPath: '/docs/chat/components/chat-input',
    promptAssetPaths: ['cockpit/chat/input/python/prompts/input.md'],
    codeAssetPaths: [
      'cockpit/chat/input/angular/src/app/input.component.ts',
      'cockpit/chat/input/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/input/python/src/graph.py'],
    runtimeUrl: 'chat/input',
    devPort: 4502,
  },
  {
    id: 'chat-interrupts-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'interrupts',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Interrupts (Python)',
    docsPath: '/docs/chat/components/chat-interrupt-panel',
    promptAssetPaths: ['cockpit/chat/interrupts/python/prompts/interrupts.md'],
    codeAssetPaths: [
      'cockpit/chat/interrupts/angular/src/app/interrupts.component.ts',
      'cockpit/chat/interrupts/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/interrupts/python/src/graph.py'],
    runtimeUrl: 'chat/interrupts',
    devPort: 4503,
  },
  {
    id: 'chat-tool-calls-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'tool-calls',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Tool Calls (Python)',
    docsPath: '/docs/chat/components/chat-tool-calls',
    promptAssetPaths: ['cockpit/chat/tool-calls/python/prompts/tool-calls.md'],
    codeAssetPaths: [
      'cockpit/chat/tool-calls/angular/src/app/tool-calls.component.ts',
      'cockpit/chat/tool-calls/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/tool-calls/python/src/graph.py'],
    runtimeUrl: 'chat/tool-calls',
    devPort: 4504,
  },
  {
    id: 'chat-subagents-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'subagents',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Subagents (Python)',
    docsPath: '/docs/chat/components/chat-subagent-card',
    promptAssetPaths: ['cockpit/chat/subagents/python/prompts/subagents.md'],
    codeAssetPaths: [
      'cockpit/chat/subagents/angular/src/app/subagents.component.ts',
      'cockpit/chat/subagents/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/subagents/python/src/graph.py'],
    runtimeUrl: 'chat/subagents',
    devPort: 4505,
  },
  {
    id: 'chat-threads-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'threads',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Threads (Python)',
    docsPath: '/docs/chat/guides/thread-routing',
    promptAssetPaths: ['cockpit/chat/threads/python/prompts/threads.md'],
    codeAssetPaths: [
      'cockpit/chat/threads/angular/src/app/threads.component.ts',
      'cockpit/chat/threads/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/threads/python/src/graph.py'],
    runtimeUrl: 'chat/threads',
    devPort: 4506,
  },
  {
    id: 'chat-timeline-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'timeline',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Timeline (Python)',
    docsPath: '/docs/chat/components/chat-trace',
    promptAssetPaths: ['cockpit/chat/timeline/python/prompts/timeline.md'],
    codeAssetPaths: [
      'cockpit/chat/timeline/angular/src/app/timeline.component.ts',
      'cockpit/chat/timeline/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/timeline/python/src/graph.py'],
    runtimeUrl: 'chat/timeline',
    devPort: 4507,
  },
  {
    id: 'chat-generative-ui-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'generative-ui',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Generative UI (Python)',
    docsPath: '/docs/chat/guides/generative-ui',
    promptAssetPaths: [
      'cockpit/chat/generative-ui/python/prompts/generative-ui.md',
    ],
    codeAssetPaths: [
      'cockpit/chat/generative-ui/angular/src/app/generative-ui.component.ts',
      'cockpit/chat/generative-ui/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/generative-ui/python/src/graph.py'],
    runtimeUrl: 'chat/generative-ui',
    devPort: 4508,
  },
  {
    id: 'chat-debug-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'debug',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Debug (Python)',
    docsPath: '/docs/chat/components/chat-debug',
    promptAssetPaths: ['cockpit/chat/debug/python/prompts/debug.md'],
    codeAssetPaths: [
      'cockpit/chat/debug/angular/src/app/debug.component.ts',
      'cockpit/chat/debug/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/debug/python/src/graph.py'],
    runtimeUrl: 'chat/debug',
    devPort: 4509,
  },
  {
    id: 'chat-theming-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'theming',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat Theming (Python)',
    docsPath: '/docs/chat/guides/theming',
    promptAssetPaths: ['cockpit/chat/theming/python/prompts/theming.md'],
    codeAssetPaths: [
      'cockpit/chat/theming/angular/src/app/theming.component.ts',
      'cockpit/chat/theming/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/theming/python/src/graph.py'],
    runtimeUrl: 'chat/theming',
    devPort: 4510,
  },
  {
    id: 'chat-a2ui-python',
    runtimeAdapter: 'langgraph',
    manifestIdentity: {
      product: 'chat',
      section: 'core-capabilities',
      topic: 'a2ui',
      page: 'overview',
      language: 'python',
    },
    title: 'Chat A2UI (Python)',
    docsPath: '/docs/chat/a2ui/overview',
    promptAssetPaths: ['cockpit/chat/a2ui/python/prompts/a2ui.md'],
    codeAssetPaths: [
      'cockpit/chat/a2ui/angular/src/app/a2ui.component.ts',
      'cockpit/chat/a2ui/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: ['cockpit/chat/a2ui/python/src/graph.py'],
    runtimeUrl: 'chat/a2ui',
    devPort: 4511,
  },
  {
    id: 'runtimes-microsoft-agent-framework-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'runtimes',
      section: 'core-capabilities',
      topic: 'microsoft-agent-framework',
      page: 'overview',
      language: 'python',
    },
    title: 'Runtimes — Microsoft Agent Framework (Python)',
    docsPath: '/docs/runtimes/microsoft-agent-framework/overview',
    promptAssetPaths: [
      'cockpit/runtimes/microsoft-agent-framework/python/prompts/microsoft-agent-framework.md',
    ],
    codeAssetPaths: [
      'cockpit/runtimes/microsoft-agent-framework/angular/src/app/microsoft-agent-framework.component.ts',
      'cockpit/runtimes/microsoft-agent-framework/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/runtimes/microsoft-agent-framework/python/src/agent.py',
      'cockpit/runtimes/microsoft-agent-framework/python/src/server.py',
    ],
    runtimeUrl: 'runtimes/microsoft-agent-framework',
    devPort: 4330,
  },
  {
    id: 'runtimes-aws-strands-python',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'runtimes',
      section: 'core-capabilities',
      topic: 'aws-strands',
      page: 'overview',
      language: 'python',
    },
    title: 'Runtimes — AWS Strands (Python)',
    docsPath: '/docs/runtimes/aws-strands/overview',
    promptAssetPaths: [
      'cockpit/runtimes/aws-strands/python/prompts/aws-strands.md',
    ],
    codeAssetPaths: [
      'cockpit/runtimes/aws-strands/angular/src/app/aws-strands.component.ts',
      'cockpit/runtimes/aws-strands/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'cockpit/runtimes/aws-strands/python/src/agent.py',
      'cockpit/runtimes/aws-strands/python/src/server.py',
    ],
    runtimeUrl: 'runtimes/aws-strands',
    devPort: 4331,
  },
  {
    id: 'runtimes-mastra-angular',
    runtimeAdapter: 'ag-ui',
    manifestIdentity: {
      product: 'runtimes',
      section: 'core-capabilities',
      topic: 'mastra',
      page: 'overview',
      language: 'angular',
    },
    title: 'Runtimes — Mastra (Angular)',
    docsPath: '/docs/runtimes/mastra/overview',
    promptAssetPaths: [
      'cockpit/runtimes/mastra/angular/prompts/mastra-backend.md',
      'cockpit/runtimes/mastra/angular/prompts/mastra.md',
    ],
    codeAssetPaths: [
      'cockpit/runtimes/mastra/angular/src/app/mastra.component.ts',
      'cockpit/runtimes/mastra/angular/src/app/app.config.ts',
    ],
    backendAssetPaths: [
      'deployments/ag-ui-mastra/agents.mjs',
      'deployments/ag-ui-mastra/server.mjs',
    ],
    runtimeUrl: 'runtimes/mastra',
    devPort: 4332,
  },
];

const freezeAssetPaths = (paths: readonly string[]): readonly string[] =>
  Object.freeze([...paths]);

const freezeCapabilityDescriptor = (
  descriptor: RegisteredCapabilityModule
): RegisteredCapabilityModule =>
  Object.freeze({
    ...descriptor,
    manifestIdentity: Object.freeze({ ...descriptor.manifestIdentity }),
    promptAssetPaths: freezeAssetPaths(descriptor.promptAssetPaths),
    codeAssetPaths: freezeAssetPaths(descriptor.codeAssetPaths),
    ...(descriptor.backendAssetPaths
      ? { backendAssetPaths: freezeAssetPaths(descriptor.backendAssetPaths) }
      : {}),
  });

export const capabilityModules: readonly RegisteredCapabilityModule[] =
  Object.freeze(capabilityModuleData.map(freezeCapabilityDescriptor));

/** Frontend variants are separate from the canonical Angular catalog. */
const streamingAngular = capabilityModules.find(
  (descriptor) => descriptor.id === 'langgraph-streaming-python'
);
const streamingReact = getCockpitFrontends().find(
  (frontend) => frontend.project === 'cockpit-langgraph-streaming-react'
);
if (!streamingAngular || !streamingReact)
  throw new Error('Streaming frontend registration is missing');

export const frontendCapabilityModules: readonly RegisteredCapabilityModule[] =
  Object.freeze([
    ...capabilityModules,
    freezeCapabilityDescriptor({
      ...streamingAngular,
      id: 'langgraph-streaming-python-react',
      frontend: 'react',
      title: 'LangGraph Streaming (React preview)',
      codeAssetPaths: [
        'cockpit/langgraph/streaming/react/src/app.tsx',
        'cockpit/langgraph/streaming/react/src/application.ts',
        'cockpit/langgraph/streaming/react/src/connection.ts',
        'cockpit/langgraph/streaming/react/src/main.tsx',
      ],
      runtimeUrl: streamingReact.runtimePath,
      devPort: streamingReact.port,
    }),
  ]);

const matchesIdentity = (
  descriptor: RegisteredCapabilityModule,
  identity: CockpitManifestIdentity
): boolean =>
  descriptor.manifestIdentity.product === identity.product &&
  descriptor.manifestIdentity.section === identity.section &&
  descriptor.manifestIdentity.topic === identity.topic &&
  descriptor.manifestIdentity.page === identity.page;

/** Select code and runtime from one frontend before resolving backend language.
 * An unsupported frontend never borrows another frontend's descriptor. */
export const getFrontendCapabilityDescriptor = (
  identity: CockpitManifestIdentity,
  frontend: CockpitFrontend,
  descriptors: readonly RegisteredCapabilityModule[] = frontendCapabilityModules
): RegisteredCapabilityModule | undefined =>
  descriptors.find(
    (descriptor) =>
      matchesIdentity(descriptor, identity) &&
      (descriptor.frontend ?? 'angular') === frontend &&
      descriptor.manifestIdentity.language === identity.language
  ) ??
  descriptors.find(
    (descriptor) =>
      matchesIdentity(descriptor, identity) &&
      (descriptor.frontend ?? 'angular') === frontend
  );

/** Existing callers retain the canonical Angular frontend. */
export const getCapabilityDescriptor = (
  identity: CockpitManifestIdentity
): RegisteredCapabilityModule | undefined =>
  getFrontendCapabilityDescriptor(identity, 'angular');

const isApiExtractable = (path: string): boolean =>
  /\.(?:ts|tsx|js|jsx|mjs|py)$/.test(path);

export const deriveAvailableModes = (options: {
  docsPath: string;
  descriptor?: RegisteredCapabilityModule;
}): readonly WorkspaceMode[] => {
  const { descriptor, docsPath } = options;
  const codeAndBackendAssets = [
    ...(descriptor?.codeAssetPaths ?? []),
    ...(descriptor?.backendAssetPaths ?? []),
  ];
  const modes: WorkspaceMode[] = [];

  if (docsPath.length > 0) {
    modes.push('Docs');
  }
  if (descriptor?.runtimeUrl || descriptor?.devPort) {
    modes.push('Run');
  }
  if (codeAndBackendAssets.length > 0) {
    modes.push('Code');
  }
  if (codeAndBackendAssets.some(isApiExtractable)) {
    modes.push('API');
  }

  return modes;
};
