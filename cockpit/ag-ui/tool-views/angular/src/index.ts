export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'tool-views';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  backendAssetPaths: string[];
}

export const agUiToolViewsAngularModule: CockpitCapabilityModule = {
  id: 'ag-ui-tool-views-angular',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'tool-views',
    page: 'overview',
    language: 'angular',
  },
  title: 'AG-UI Tool Views (Angular)',
  docsPath: '/docs/angular/ag-ui/guides/tool-views',
  promptAssetPaths: ['cockpit/ag-ui/tool-views/angular/prompts/tool-views.md'],
  codeAssetPaths: [
    'cockpit/ag-ui/tool-views/angular/src/app/tool-views.component.ts',
    'cockpit/ag-ui/tool-views/angular/src/app/weather-card.component.ts',
    'cockpit/ag-ui/tool-views/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/tool-views/python/src/graph.py',
    'cockpit/ag-ui/tool-views/python/src/server.py',
  ],
};
