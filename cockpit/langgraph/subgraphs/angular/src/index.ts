export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'subgraphs';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const langgraphSubgraphsAngularModule: CockpitCapabilityModule = {
  id: 'langgraph-subgraphs-angular',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'subgraphs',
    page: 'overview',
    language: 'angular',
  },
  title: 'LangGraph Subgraphs (Angular)',
  docsPath: '/docs/angular/langgraph/guides/subgraphs',
  promptAssetPaths: [
    'cockpit/langgraph/subgraphs/angular/prompts/subgraphs.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/subgraphs/angular/src/app/subgraphs.component.ts',
  ],
};
