export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'ag-ui';
    section: 'core-capabilities';
    topic: 'interrupts';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const agUiInterruptsAngularModule: CockpitCapabilityModule = {
  id: 'ag-ui-interrupts-angular',
  manifestIdentity: {
    product: 'ag-ui',
    section: 'core-capabilities',
    topic: 'interrupts',
    page: 'overview',
    language: 'angular',
  },
  title: 'AG-UI Interrupts (Angular)',
  docsPath: '/docs/angular/ag-ui/guides/interrupts',
  promptAssetPaths: [
    'cockpit/ag-ui/interrupts/angular/prompts/interrupts.md',
  ],
  codeAssetPaths: [
    'cockpit/ag-ui/interrupts/angular/src/app/interrupts.component.ts',
    'cockpit/ag-ui/interrupts/angular/src/app/app.config.ts',
  ],
};
