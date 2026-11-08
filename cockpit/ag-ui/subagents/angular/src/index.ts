export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'subagents';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  backendAssetPaths: string[];
}

export const agUiSubagentsAngularModule: CockpitCapabilityModule = {
  id: 'ag-ui-subagents-angular',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'subagents',
    page: 'overview',
    language: 'angular',
  },
  title: 'AG-UI Subagents (Angular)',
  docsPath: '/docs/angular/ag-ui/guides/subagents',
  promptAssetPaths: [
    'cockpit/ag-ui/subagents/angular/prompts/subagents.md',
  ],
  codeAssetPaths: [
    'cockpit/ag-ui/subagents/angular/src/app/subagents.component.ts',
    'cockpit/ag-ui/subagents/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/subagents/python/src/graph.py',
    'cockpit/ag-ui/subagents/python/src/server.py',
  ],
};
