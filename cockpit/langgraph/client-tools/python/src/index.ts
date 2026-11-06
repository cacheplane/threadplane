export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'client-tools';
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

export const langgraphClientToolsPythonModule: CockpitCapabilityModule = {
  id: 'langgraph-client-tools-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'client-tools',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Client Tools (Python)',
  docsPath: '/docs/angular/chat/guides/client-tools',
  promptAssetPaths: ['cockpit/langgraph/client-tools/python/prompts/client-tools.md'],
  codeAssetPaths: [
    'cockpit/langgraph/client-tools/angular/src/app/client-tools.component.ts',
    'cockpit/langgraph/client-tools/angular/src/app/weather-card.component.ts',
    'cockpit/langgraph/client-tools/angular/src/app/confirm-booking.component.ts',
    'cockpit/langgraph/client-tools/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/client-tools/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/client-tools',
  devPort: 4308,
};
