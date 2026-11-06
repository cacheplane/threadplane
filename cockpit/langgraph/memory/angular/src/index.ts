export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'memory';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const langgraphMemoryAngularModule: CockpitCapabilityModule = {
  id: 'langgraph-memory-angular',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'memory',
    page: 'overview',
    language: 'angular',
  },
  title: 'LangGraph Memory (Angular)',
  docsPath: '/docs/angular/langgraph/guides/memory',
  promptAssetPaths: [
    'cockpit/langgraph/memory/angular/prompts/memory.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/memory/angular/src/app.component.ts',
  ],
};
