export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'deployment-runtime';
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

export const langgraphDeploymentRuntimePythonModule: CockpitCapabilityModule = {
  id: 'langgraph-deployment-runtime-python',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'deployment-runtime',
    page: 'overview',
    language: 'python',
  },
  title: 'LangGraph Deployment Runtime (Python)',
  docsPath: '/docs/angular/langgraph/guides/deployment',
  promptAssetPaths: [
    'cockpit/langgraph/deployment-runtime/python/prompts/deployment-runtime.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/deployment-runtime/angular/src/app/deployment-runtime.component.ts',
    'cockpit/langgraph/deployment-runtime/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/langgraph/deployment-runtime/python/src/graph.py',
  ],
  runtimeUrl: 'langgraph/deployment-runtime',
  devPort: 4307,
};
