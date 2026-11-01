export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'element-rendering';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const renderElementRenderingAngularModule: CockpitCapabilityModule = {
  id: 'render-element-rendering-angular',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'element-rendering',
    page: 'overview',
    language: 'angular',
  },
  title: 'Render Element Rendering (Angular)',
  docsPath: '/docs/render/guides/element-rendering',
  promptAssetPaths: ['cockpit/render/element-rendering/angular/prompts/element-rendering.md'],
  codeAssetPaths: ['cockpit/render/element-rendering/angular/src/app/element-rendering.component.ts'],
};
