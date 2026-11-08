export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'registry';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const renderRegistryAngularModule: CockpitCapabilityModule = {
  id: 'render-registry-angular',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'registry',
    page: 'overview',
    language: 'angular',
  },
  title: 'Render Registry (Angular)',
  docsPath: '/docs/angular/render/guides/registry',
  promptAssetPaths: ['cockpit/render/registry/angular/prompts/registry.md'],
  codeAssetPaths: ['cockpit/render/registry/angular/src/app/registry.component.ts'],
};
