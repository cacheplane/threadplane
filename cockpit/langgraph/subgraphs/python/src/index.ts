export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'subgraphs';
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

export const langgraphSubgraphsPythonModule: CockpitCapabilityModule = {
  id: 'langgraph-subgraphs-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'subgraphs',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Subgraphs (Python)',
  docsPath: '/docs/angular/langgraph/guides/subgraphs',
  promptAssetPaths: ['cockpit/langgraph/subgraphs/python/prompts/subgraphs.md'],
  codeAssetPaths: [
    'cockpit/langgraph/subgraphs/angular/src/app/agent-ref.ts',
    'cockpit/langgraph/subgraphs/angular/src/app/subgraphs.component.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/subgraphs/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/subgraphs',
  devPort: 4305,
};
