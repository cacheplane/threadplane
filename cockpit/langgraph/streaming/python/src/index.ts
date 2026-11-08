export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'streaming';
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

export const langgraphStreamingPythonModule: CockpitCapabilityModule = {
  id: 'langgraph-streaming-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'streaming',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Streaming (Python)',
  docsPath: '/docs/angular/langgraph/guides/streaming',
  promptAssetPaths: ['cockpit/langgraph/streaming/python/prompts/streaming.md'],
  codeAssetPaths: [
    'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
    'cockpit/langgraph/streaming/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/streaming/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/streaming',
  devPort: 4300,
};
