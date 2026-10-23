export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'deep-agents';
    section: 'core-capabilities';
    topic: 'memory';
    page: 'overview';
    language: 'python';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  backendAssetPaths: string[];
  runtimeUrl?: string;
  devPort?: number;
}

export const deepAgentsMemoryPythonModule: CockpitCapabilityModule = {
  id: 'deep-agents-memory-python',
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
    'cockpit/deep-agents/memory/angular/src/app/memory-scope.ts',
    'cockpit/deep-agents/memory/angular/src/app/memory-transport.ts',
    'cockpit/deep-agents/memory/angular/src/app/memory-agent-gate.ts',
  ],
  backendAssetPaths: [
    'cockpit/deep-agents/memory/python/src/graph.py',
    'cockpit/deep-agents/memory/python/src/memory_observation.py',
  ],
  runtimeUrl: 'deep-agents/memory',
  devPort: 4313,
};
