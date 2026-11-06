export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'repeat-loops';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const renderRepeatLoopsAngularModule: CockpitCapabilityModule = {
  id: 'render-repeat-loops-angular',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'repeat-loops',
    page: 'overview',
    language: 'angular',
  },
  title: 'Render Repeat Loops (Angular)',
  docsPath: '/docs/angular/render/guides/repeat-loops',
  promptAssetPaths: ['cockpit/render/repeat-loops/angular/prompts/repeat-loops.md'],
  codeAssetPaths: ['cockpit/render/repeat-loops/angular/src/app/repeat-loops.component.ts'],
};
