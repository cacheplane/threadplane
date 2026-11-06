export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'json-render';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  backendAssetPaths: string[];
}

export const agUiJsonRenderAngularModule: CockpitCapabilityModule = {
  id: 'ag-ui-json-render-angular',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'json-render',
    page: 'overview',
    language: 'angular',
  },
  title: 'AG-UI JSON Render (Angular)',
  docsPath: '/docs/angular/ag-ui/guides/json-render',
  promptAssetPaths: ['cockpit/ag-ui/json-render/python/prompts/json-render.md'],
  codeAssetPaths: [
    'cockpit/ag-ui/json-render/angular/src/app/json-render.component.ts',
    'cockpit/ag-ui/json-render/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/json-render/python/src/graph.py',
    'cockpit/ag-ui/json-render/python/src/server.py',
  ],
};
