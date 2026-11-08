export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
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

export const langgraphMemoryPythonModule: CockpitCapabilityModule = {
  id: 'langgraph-memory-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'memory',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Memory (Python)',
  docsPath: '/docs/angular/langgraph/guides/memory',
  promptAssetPaths: ['cockpit/langgraph/memory/python/prompts/memory.md'],
  codeAssetPaths: [
    'cockpit/langgraph/memory/angular/src/app/memory.component.ts',
    'cockpit/langgraph/memory/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/memory/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/memory',
  devPort: 4303,
};
