export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'deployment-runtime';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const langgraphDeploymentRuntimeAngularModule: CockpitCapabilityModule = {
  id: 'langgraph-deployment-runtime-angular',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'deployment-runtime',
    page: 'overview',
    language: 'angular',
  },
  title: 'LangGraph Deployment & Runtime (Angular)',
  docsPath: '/docs/angular/langgraph/guides/deployment',
  promptAssetPaths: [
    'cockpit/langgraph/deployment-runtime/angular/prompts/deployment-runtime.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/deployment-runtime/angular/src/app.component.ts',
  ],
};
