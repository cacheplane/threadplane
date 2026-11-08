export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'time-travel';
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

export const langgraphTimeTravelPythonModule: CockpitCapabilityModule = {
  id: 'langgraph-time-travel-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'time-travel',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Time Travel (Python)',
  docsPath: '/docs/angular/langgraph/guides/time-travel',
  promptAssetPaths: ['cockpit/langgraph/time-travel/python/prompts/time-travel.md'],
  codeAssetPaths: [
    'cockpit/langgraph/time-travel/angular/src/app/time-travel.component.ts',
    'cockpit/langgraph/time-travel/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/time-travel/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/time-travel',
  devPort: 4306,
};
