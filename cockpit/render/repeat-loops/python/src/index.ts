export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'repeat-loops';
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

export const renderRepeatLoopsPythonModule: CockpitCapabilityModule = {
  id: 'render-repeat-loops-python',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'repeat-loops',
    page: 'overview',
    language: 'python',
  },
  title: 'Render Repeat Loops (Python)',
  docsPath: '/docs/angular/render/guides/repeat-loops',
  promptAssetPaths: [
    'cockpit/render/repeat-loops/python/prompts/repeat-loops.md',
  ],
  codeAssetPaths: [
    'cockpit/render/repeat-loops/angular/src/app/repeat-loops.component.ts',
    'cockpit/render/repeat-loops/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: ['cockpit/render/repeat-loops/python/src/graph.py'],
  runtimeUrl: 'render/repeat-loops',
  devPort: 4405,
};
