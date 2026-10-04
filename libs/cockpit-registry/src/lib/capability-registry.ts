import type { CockpitFrontend, RuntimeAdapter } from './manifest.types';

/**
 * Single source of truth for all cockpit capability examples.
 * Used by serve, build, test, and deploy scripts.
 */
/**
 * Backend framework of an AG-UI-served capability (products 'ag-ui' and
 * 'runtimes'). Selects the framework adapter in
 * scripts/generate-ag-ui-deployment-config.ts: the bridge import, the
 * per-topic module contract (`src/graph.py` exposing `graph` for LangGraph
 * vs `src/agent.py` exposing `agent` for Microsoft Agent Framework), and
 * the FastAPI mount call. Omitted means 'langgraph'.
 *
 * 'mastra' is the TypeScript hosting lane (Lane B): its backend is the
 * hand-written Node service deployments/ag-ui-mastra, NOT the aggregated
 * Python deployment — a 'mastra' capability therefore has no pythonDir and
 * the Python deployment generator never stages it.
 */
export type CapabilityFramework = 'langgraph' | 'microsoft-agent-framework' | 'aws-strands' | 'mastra';

export interface Capability {
  id: string;
  runtimeAdapter: RuntimeAdapter;
  /**
   * 'runtimes' is the one-capability-many-runtimes axis
   * (cockpit/runtimes/<runtime>/): non-LangGraph AG-UI backends measured
   * against the same neutral Agent contract. Like AG-UI caps, they are
   * served by the aggregated deployments/ag-ui-dev FastAPI app.
   */
  product: 'langgraph' | 'deep-agents' | 'render' | 'chat' | 'ag-ui' | 'runtimes';
  topic: string;
  angularProject: string;
  port: number;
  /** Additional frontend implementations share this capability's backend. */
  react?: { project: string; port: number };
  pythonPort?: number;
  /** Optional — AG-UI caps run in-process via FakeAgent and have no Python backend. */
  pythonDir?: string;
  /** Optional — see pythonDir. */
  graphName?: string;
  /** AG-UI backend framework; defaults to 'langgraph' when omitted. */
  framework?: CapabilityFramework;
}

// NOTE: registry changes must reach production through a run whose diff range
// includes this file — see the deploy-gate hazard note in
// scripts/assemble-examples.ts before assuming a green main run deployed them.
export const capabilities: readonly Capability[] = [
  { id: 'streaming', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'streaming', angularProject: 'cockpit-langgraph-streaming-angular', port: 4300, react: { project: 'cockpit-langgraph-streaming-react', port: 4600 }, pythonPort: 5300, pythonDir: 'cockpit/langgraph/streaming/python', graphName: 'streaming' },
  { id: 'persistence', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'persistence', angularProject: 'cockpit-langgraph-persistence-angular', port: 4301, react: { project: 'cockpit-langgraph-persistence-react', port: 4604 }, pythonPort: 5301, pythonDir: 'cockpit/langgraph/persistence/python', graphName: 'persistence' },
  { id: 'interrupts', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'interrupts', angularProject: 'cockpit-langgraph-interrupts-angular', port: 4302, pythonPort: 5302, pythonDir: 'cockpit/langgraph/interrupts/python', graphName: 'interrupts', react: { project: 'cockpit-langgraph-interrupts-react', port: 4601 } },
  { id: 'memory', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'memory', angularProject: 'cockpit-langgraph-memory-angular', port: 4303, pythonPort: 5303, pythonDir: 'cockpit/langgraph/memory/python', graphName: 'memory', react: { project: 'cockpit-langgraph-memory-react', port: 4602 } },
  { id: 'durable-execution', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'durable-execution', angularProject: 'cockpit-langgraph-durable-execution-angular', port: 4304, react: { project: 'cockpit-langgraph-durable-execution-react', port: 4605 }, pythonPort: 5304, pythonDir: 'cockpit/langgraph/durable-execution/python', graphName: 'durable-execution' },
  { id: 'subgraphs', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'subgraphs', angularProject: 'cockpit-langgraph-subgraphs-angular', port: 4305, react: { project: 'cockpit-langgraph-subgraphs-react', port: 4606 }, pythonPort: 5305, pythonDir: 'cockpit/langgraph/subgraphs/python', graphName: 'subgraphs' },
  { id: 'time-travel', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'time-travel', angularProject: 'cockpit-langgraph-time-travel-angular', port: 4306, react: { project: 'cockpit-langgraph-time-travel-react', port: 4607 }, pythonPort: 5306, pythonDir: 'cockpit/langgraph/time-travel/python', graphName: 'time-travel' },
  { id: 'deployment-runtime', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'deployment-runtime', angularProject: 'cockpit-langgraph-deployment-runtime-angular', port: 4307, react: { project: 'cockpit-langgraph-deployment-runtime-react', port: 4608 }, pythonPort: 5307, pythonDir: 'cockpit/langgraph/deployment-runtime/python', graphName: 'deployment-runtime' },
  { id: 'langgraph-client-tools', runtimeAdapter: 'langgraph', product: 'langgraph', topic: 'client-tools', angularProject: 'cockpit-langgraph-client-tools-angular', port: 4308, pythonPort: 5308, pythonDir: 'cockpit/langgraph/client-tools/python', graphName: 'client-tools', react: { project: 'cockpit-langgraph-client-tools-react', port: 4603 } },
  { id: 'da-planning', runtimeAdapter: 'langgraph', product: 'deep-agents', topic: 'planning', angularProject: 'cockpit-deep-agents-planning-angular', port: 4310, pythonPort: 5310, pythonDir: 'cockpit/deep-agents/planning/python', graphName: 'da-planning' },
  { id: 'da-filesystem', runtimeAdapter: 'langgraph', product: 'deep-agents', topic: 'filesystem', angularProject: 'cockpit-deep-agents-filesystem-angular', port: 4311, pythonPort: 5311, pythonDir: 'cockpit/deep-agents/filesystem/python', graphName: 'da-filesystem' },
  { id: 'da-subagents', runtimeAdapter: 'langgraph', product: 'deep-agents', topic: 'subagents', angularProject: 'cockpit-deep-agents-subagents-angular', port: 4312, pythonPort: 5312, pythonDir: 'cockpit/deep-agents/subagents/python', graphName: 'subagents' },
  { id: 'da-memory', runtimeAdapter: 'langgraph', product: 'deep-agents', topic: 'memory', angularProject: 'cockpit-deep-agents-memory-angular', port: 4313, pythonPort: 5313, pythonDir: 'cockpit/deep-agents/memory/python', graphName: 'da-memory' },
  { id: 'da-skills', runtimeAdapter: 'langgraph', product: 'deep-agents', topic: 'skills', angularProject: 'cockpit-deep-agents-skills-angular', port: 4314, pythonPort: 5314, pythonDir: 'cockpit/deep-agents/skills/python', graphName: 'da-skills' },
  // Render capabilities
  { id: 'r-spec-rendering', runtimeAdapter: 'none', product: 'render', topic: 'spec-rendering', angularProject: 'cockpit-render-spec-rendering-angular', port: 4401, react: { project: 'cockpit-render-spec-rendering-react', port: 4614 }, pythonPort: 5401, pythonDir: 'cockpit/render/spec-rendering/python', graphName: 'r-spec-rendering' },
  { id: 'r-element-rendering', runtimeAdapter: 'none', product: 'render', topic: 'element-rendering', angularProject: 'cockpit-render-element-rendering-angular', port: 4402, react: { project: 'cockpit-render-element-rendering-react', port: 4618 }, pythonPort: 5402, pythonDir: 'cockpit/render/element-rendering/python', graphName: 'r-element-rendering' },
  { id: 'r-state-management', runtimeAdapter: 'none', product: 'render', topic: 'state-management', angularProject: 'cockpit-render-state-management-angular', port: 4403, react: { project: 'cockpit-render-state-management-react', port: 4615 }, pythonPort: 5403, pythonDir: 'cockpit/render/state-management/python', graphName: 'r-state-management' },
  { id: 'r-registry', runtimeAdapter: 'none', product: 'render', topic: 'registry', angularProject: 'cockpit-render-registry-angular', port: 4404, react: { project: 'cockpit-render-registry-react', port: 4617 }, pythonPort: 5404, pythonDir: 'cockpit/render/registry/python', graphName: 'r-registry' },
  { id: 'r-repeat-loops', runtimeAdapter: 'none', product: 'render', topic: 'repeat-loops', angularProject: 'cockpit-render-repeat-loops-angular', port: 4405, react: { project: 'cockpit-render-repeat-loops-react', port: 4616 }, pythonPort: 5405, pythonDir: 'cockpit/render/repeat-loops/python', graphName: 'r-repeat-loops' },
  { id: 'r-computed-functions', runtimeAdapter: 'none', product: 'render', topic: 'computed-functions', angularProject: 'cockpit-render-computed-functions-angular', port: 4406, react: { project: 'cockpit-render-computed-functions-react', port: 4619 }, pythonPort: 5406, pythonDir: 'cockpit/render/computed-functions/python', graphName: 'r-computed-functions' },
  // Chat capabilities
  { id: 'c-messages', runtimeAdapter: 'langgraph', product: 'chat', topic: 'messages', angularProject: 'cockpit-chat-messages-angular', port: 4501, pythonPort: 5501, pythonDir: 'cockpit/chat/messages/python', graphName: 'c-messages' },
  { id: 'c-input', runtimeAdapter: 'langgraph', product: 'chat', topic: 'input', angularProject: 'cockpit-chat-input-angular', port: 4502, pythonPort: 5502, pythonDir: 'cockpit/chat/input/python', graphName: 'c-input' },
  { id: 'c-interrupts', runtimeAdapter: 'langgraph', product: 'chat', topic: 'interrupts', angularProject: 'cockpit-chat-interrupts-angular', port: 4503, pythonPort: 5503, pythonDir: 'cockpit/chat/interrupts/python', graphName: 'c-interrupts' },
  { id: 'c-tool-calls', runtimeAdapter: 'langgraph', product: 'chat', topic: 'tool-calls', angularProject: 'cockpit-chat-tool-calls-angular', port: 4504, pythonPort: 5504, pythonDir: 'cockpit/chat/tool-calls/python', graphName: 'c-tool-calls' },
  { id: 'c-subagents', runtimeAdapter: 'langgraph', product: 'chat', topic: 'subagents', angularProject: 'cockpit-chat-subagents-angular', port: 4505, pythonPort: 5505, pythonDir: 'cockpit/chat/subagents/python', graphName: 'c-subagents' },
  { id: 'c-threads', runtimeAdapter: 'langgraph', product: 'chat', topic: 'threads', angularProject: 'cockpit-chat-threads-angular', port: 4506, pythonPort: 5506, pythonDir: 'cockpit/chat/threads/python', graphName: 'c-threads' },
  { id: 'c-timeline', runtimeAdapter: 'langgraph', product: 'chat', topic: 'timeline', angularProject: 'cockpit-chat-timeline-angular', port: 4507, pythonPort: 5507, pythonDir: 'cockpit/chat/timeline/python', graphName: 'c-timeline' },
  { id: 'c-generative-ui', runtimeAdapter: 'langgraph', product: 'chat', topic: 'generative-ui', angularProject: 'cockpit-chat-generative-ui-angular', port: 4508, pythonPort: 5508, pythonDir: 'cockpit/chat/generative-ui/python', graphName: 'c-generative-ui' },
  { id: 'c-debug', runtimeAdapter: 'langgraph', product: 'chat', topic: 'debug', angularProject: 'cockpit-chat-debug-angular', port: 4509, pythonPort: 5509, pythonDir: 'cockpit/chat/debug/python', graphName: 'c-debug' },
  { id: 'c-theming', runtimeAdapter: 'langgraph', product: 'chat', topic: 'theming', angularProject: 'cockpit-chat-theming-angular', port: 4510, pythonPort: 5510, pythonDir: 'cockpit/chat/theming/python', graphName: 'c-theming' },
  { id: 'c-a2ui', runtimeAdapter: 'langgraph', product: 'chat', topic: 'a2ui', angularProject: 'cockpit-chat-a2ui-angular', port: 4511, pythonPort: 5511, pythonDir: 'cockpit/chat/a2ui/python', graphName: 'c-a2ui' },
  // AG-UI capabilities (uvicorn ag-ui-langgraph backend; not deployed to LangSmith)
  { id: 'ag-ui-interrupts', runtimeAdapter: 'ag-ui', product: 'ag-ui', topic: 'interrupts', angularProject: 'cockpit-ag-ui-interrupts-angular', port: 4320, react: { project: 'cockpit-ag-ui-interrupts-react', port: 4610 }, pythonPort: 5320, pythonDir: 'cockpit/ag-ui/interrupts/python' },
  { id: 'ag-ui-streaming', runtimeAdapter: 'ag-ui', product: 'ag-ui', topic: 'streaming', angularProject: 'cockpit-ag-ui-streaming-angular', port: 4321, react: { project: 'cockpit-ag-ui-streaming-react', port: 4609 }, pythonPort: 5321, pythonDir: 'cockpit/ag-ui/streaming/python' },
  { id: 'ag-ui-tool-views', runtimeAdapter: 'ag-ui', product: 'ag-ui', topic: 'tool-views', angularProject: 'cockpit-ag-ui-tool-views-angular', port: 4322, react: { project: 'cockpit-ag-ui-tool-views-react', port: 4611 }, pythonPort: 5322, pythonDir: 'cockpit/ag-ui/tool-views/python' },
  { id: 'ag-ui-json-render', runtimeAdapter: 'ag-ui', product: 'ag-ui', topic: 'json-render', angularProject: 'cockpit-ag-ui-json-render-angular', port: 4323, react: { project: 'cockpit-ag-ui-json-render-react', port: 4612 }, pythonPort: 5323, pythonDir: 'cockpit/ag-ui/json-render/python' },
  { id: 'ag-ui-client-tools', runtimeAdapter: 'ag-ui', product: 'ag-ui', topic: 'client-tools', angularProject: 'cockpit-ag-ui-client-tools-angular', port: 4325, pythonPort: 5325, pythonDir: 'cockpit/ag-ui/client-tools/python' },
  { id: 'ag-ui-a2ui', runtimeAdapter: 'ag-ui', product: 'ag-ui', topic: 'a2ui', angularProject: 'cockpit-ag-ui-a2ui-angular', port: 4324, pythonPort: 5324, pythonDir: 'cockpit/ag-ui/a2ui/python' },
  { id: 'ag-ui-subagents', runtimeAdapter: 'ag-ui', product: 'ag-ui', topic: 'subagents', angularProject: 'cockpit-ag-ui-subagents-angular', port: 4326, react: { project: 'cockpit-ag-ui-subagents-react', port: 4613 }, pythonPort: 5326, pythonDir: 'cockpit/ag-ui/subagents/python' },
  // Runtime-portability examples (one capability, many runtimes; AG-UI-served
  // like the AG-UI caps, but the backend is genuinely non-LangGraph)
  { id: 'rt-maf', runtimeAdapter: 'ag-ui', product: 'runtimes', topic: 'microsoft-agent-framework', angularProject: 'cockpit-runtimes-microsoft-agent-framework-angular', port: 4330, pythonPort: 5330, pythonDir: 'cockpit/runtimes/microsoft-agent-framework/python', framework: 'microsoft-agent-framework' },
  { id: 'rt-strands', runtimeAdapter: 'ag-ui', product: 'runtimes', topic: 'aws-strands', angularProject: 'cockpit-runtimes-aws-strands-angular', port: 4331, pythonPort: 5331, pythonDir: 'cockpit/runtimes/aws-strands/python', framework: 'aws-strands' },
  // No pythonDir: the Mastra topic's backend is the hand-written Node
  // service deployments/ag-ui-mastra (start it locally on pythonPort — here
  // meaning "backend port" — for dev/e2e; see that service's README).
  { id: 'rt-mastra', runtimeAdapter: 'ag-ui', product: 'runtimes', topic: 'mastra', angularProject: 'cockpit-runtimes-mastra-angular', port: 4332, pythonPort: 5332, framework: 'mastra' },
] as const;

export function findCapability(id: string): Capability | undefined {
  return capabilities.find((c) => c.id === id);
}

export function allAngularProjects(): string[] {
  return capabilities.map((c) => c.angularProject);
}

export interface CockpitFrontendDeployment {
  frontend: CockpitFrontend;
  project: string;
  port: number;
  product: Capability['product'];
  topic: string;
  runtimePath: string;
  buildOutput: string;
}

/** Enumerate frontend assets without creating duplicate backend capabilities. */
export function getCockpitFrontends(): CockpitFrontendDeployment[] {
  return capabilities.flatMap((capability) => {
    const path = `${capability.product}/${capability.topic}`;
    const angular: CockpitFrontendDeployment = {
      frontend: 'angular', project: capability.angularProject, port: capability.port,
      product: capability.product, topic: capability.topic, runtimePath: path,
      buildOutput: `dist/cockpit/${path}/angular`,
    };
    return capability.react ? [angular, {
      frontend: 'react' as const, project: capability.react.project, port: capability.react.port,
      product: capability.product, topic: capability.topic, runtimePath: `${path}/react`,
      buildOutput: `dist/cockpit/${path}/react`,
    }] : [angular];
  });
}
