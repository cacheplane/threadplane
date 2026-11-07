export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'persistence';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const langgraphPersistenceAngularModule: CockpitCapabilityModule = {
  id: 'langgraph-persistence-angular',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'persistence',
    page: 'overview',
    language: 'angular',
  },
  title: 'LangGraph Persistence (Angular)',
  docsPath: '/docs/angular/langgraph/guides/persistence',
  promptAssetPaths: [
    'cockpit/langgraph/persistence/angular/prompts/persistence.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/persistence/angular/src/app.component.ts',
  ],
};
