export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'persistence';
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

export const langgraphPersistencePythonModule: CockpitCapabilityModule = {
  id: 'langgraph-persistence-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'persistence',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Persistence (Python)',
  docsPath: '/docs/angular/langgraph/guides/persistence',
  promptAssetPaths: ['cockpit/langgraph/persistence/python/prompts/persistence.md'],
  codeAssetPaths: [
    'cockpit/langgraph/persistence/angular/src/app/persistence.component.ts',
    'cockpit/langgraph/persistence/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/persistence/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/persistence',
  devPort: 4301,
};
