export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'client-tools';
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

export const agUiClientToolsPythonModule: CockpitCapabilityModule = {
  id: 'ag-ui-client-tools-python',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'client-tools',
    page: 'overview',
    language: 'python',
  },
  title: 'AG-UI Client Tools (Python)',
  docsPath: '/docs/angular/ag-ui/guides/client-tools',
  promptAssetPaths: [
    'cockpit/ag-ui/client-tools/python/prompts/client-tools.md',
  ],
  codeAssetPaths: [
    'cockpit/ag-ui/client-tools/angular/src/app/client-tools.component.ts',
    'cockpit/ag-ui/client-tools/angular/src/app/weather-card.component.ts',
    'cockpit/ag-ui/client-tools/angular/src/app/confirm-booking.component.ts',
    'cockpit/ag-ui/client-tools/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/client-tools/python/src/graph.py',
    'cockpit/ag-ui/client-tools/python/src/server.py',
  ],
  runtimeUrl: 'ag-ui/client-tools',
  devPort: 4325,
};
