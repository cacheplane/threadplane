export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'computed-functions';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const renderComputedFunctionsAngularModule: CockpitCapabilityModule = {
  id: 'render-computed-functions-angular',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'computed-functions',
    page: 'overview',
    language: 'angular',
  },
  title: 'Render Computed Functions (Angular)',
  docsPath: '/docs/render/guides/computed-functions',
  promptAssetPaths: ['cockpit/render/computed-functions/angular/prompts/computed-functions.md'],
  codeAssetPaths: ['cockpit/render/computed-functions/angular/src/app/computed-functions.component.ts'],
};
