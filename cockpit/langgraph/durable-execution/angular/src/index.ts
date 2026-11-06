export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'durable-execution';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const langgraphDurableExecutionAngularModule: CockpitCapabilityModule = {
  id: 'langgraph-durable-execution-angular',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'durable-execution',
    page: 'overview',
    language: 'angular',
  },
  title: 'LangGraph Durable Execution (Angular)',
  docsPath: '/docs/angular/langgraph/guides/durable-execution',
  promptAssetPaths: [
    'cockpit/langgraph/durable-execution/angular/prompts/durable-execution.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/durable-execution/angular/src/app.component.ts',
  ],
};
