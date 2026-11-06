export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'state-management';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const renderStateManagementAngularModule: CockpitCapabilityModule = {
  id: 'render-state-management-angular',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'state-management',
    page: 'overview',
    language: 'angular',
  },
  title: 'Render State Management (Angular)',
  docsPath: '/docs/angular/render/guides/state-store',
  promptAssetPaths: ['cockpit/render/state-management/angular/prompts/state-management.md'],
  codeAssetPaths: ['cockpit/render/state-management/angular/src/app/state-management.component.ts'],
};
