export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'subagents';
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

export const agUiSubagentsPythonModule: CockpitCapabilityModule = {
  id: 'ag-ui-subagents-python',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'subagents',
    page: 'overview',
    language: 'python',
  },
  title: 'AG-UI Subagents (Python)',
  docsPath: '/docs/angular/ag-ui/guides/subagents',
  promptAssetPaths: ['cockpit/ag-ui/subagents/python/prompts/subagents.md'],
  codeAssetPaths: [
    'cockpit/ag-ui/subagents/angular/src/app/subagents.component.ts',
    'cockpit/ag-ui/subagents/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/subagents/python/src/graph.py',
    'cockpit/ag-ui/subagents/python/src/server.py',
  ],
  runtimeUrl: 'ag-ui/subagents',
  devPort: 4326,
};
