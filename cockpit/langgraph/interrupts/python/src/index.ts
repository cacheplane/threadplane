export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'interrupts';
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

export const langgraphInterruptsPythonModule: CockpitCapabilityModule = {
  id: 'langgraph-interrupts-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'interrupts',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Interrupts (Python)',
  docsPath: '/docs/angular/langgraph/guides/interrupts',
  promptAssetPaths: ['cockpit/langgraph/interrupts/python/prompts/interrupts.md'],
  codeAssetPaths: [
    'cockpit/langgraph/interrupts/angular/src/app/interrupts.component.ts',
    'cockpit/langgraph/interrupts/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/interrupts/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/interrupts',
  devPort: 4302,
};
