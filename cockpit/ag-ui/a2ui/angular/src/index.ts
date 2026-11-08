export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'a2ui';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  backendAssetPaths: string[];
}

export const agUiA2uiAngularModule: CockpitCapabilityModule = {
  id: 'ag-ui-a2ui-angular',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'a2ui',
    page: 'overview',
    language: 'angular',
  },
  title: 'AG-UI A2UI (Angular)',
  docsPath: '/docs/angular/a2ui/getting-started/introduction',
  promptAssetPaths: [],
  codeAssetPaths: [
    'cockpit/ag-ui/a2ui/angular/src/app/a2ui.component.ts',
    'cockpit/ag-ui/a2ui/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/a2ui/python/src/graph.py',
    'cockpit/ag-ui/a2ui/python/src/server.py',
  ],
};
