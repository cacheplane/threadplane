export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'streaming';
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

export const agUiStreamingPythonModule: CockpitCapabilityModule = {
  id: 'ag-ui-streaming-python',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'streaming',
    page: 'overview',
    language: 'python',
  },
  title: 'AG-UI Streaming (Python)',
  docsPath: '/docs/angular/ag-ui/reference/event-mapping',
  promptAssetPaths: ['cockpit/ag-ui/streaming/python/prompts/streaming.md'],
  codeAssetPaths: [
    'cockpit/ag-ui/streaming/angular/src/app/streaming.component.ts',
    'cockpit/ag-ui/streaming/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: ['cockpit/ag-ui/streaming/python/src/graph.py', 'cockpit/ag-ui/streaming/python/src/server.py'],
  runtimeUrl: 'ag-ui/streaming',
  devPort: 4321,
};
