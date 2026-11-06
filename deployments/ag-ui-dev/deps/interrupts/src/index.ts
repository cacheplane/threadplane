export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'interrupts';
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

export const agUiInterruptsPythonModule: CockpitCapabilityModule = {
  id: 'ag-ui-interrupts-python',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'interrupts',
    page: 'overview',
    language: 'python',
  },
  title: 'AG-UI Interrupts (Python)',
  docsPath: '/docs/angular/ag-ui/guides/interrupts',
  promptAssetPaths: ['cockpit/ag-ui/interrupts/python/prompts/interrupts.md'],
  codeAssetPaths: [
    'cockpit/ag-ui/interrupts/angular/src/app/interrupts.component.ts',
    'cockpit/ag-ui/interrupts/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/ag-ui/interrupts/python/src/graph.py',
    'cockpit/ag-ui/interrupts/python/src/server.py',
  ],
  runtimeUrl: 'ag-ui/interrupts',
  devPort: 4320,
};
