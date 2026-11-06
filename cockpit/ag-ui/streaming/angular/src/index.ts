export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'streaming';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  backendAssetPaths: string[];
}

export const agUiStreamingAngularModule: CockpitCapabilityModule = {
  id: 'ag-ui-streaming-angular',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'streaming',
    page: 'overview',
    language: 'angular',
  },
  title: 'AG-UI Streaming (Angular)',
  docsPath: '/docs/angular/ag-ui/reference/event-mapping',
  promptAssetPaths: [
    'cockpit/ag-ui/streaming/angular/prompts/streaming.md',
  ],
  codeAssetPaths: [
    'cockpit/ag-ui/streaming/angular/src/app/streaming.component.ts',
    'cockpit/ag-ui/streaming/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/streaming/python/src/graph.py',
    'cockpit/ag-ui/streaming/python/src/server.py',
  ],
};
