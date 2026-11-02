export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'element-rendering';
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

export const renderElementRenderingPythonModule: CockpitCapabilityModule = {
  id: 'render-element-rendering-python',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'element-rendering',
    page: 'overview',
    language: 'python',
  },
  title: 'Render Element Rendering (Python)',
  docsPath: '/docs/render/guides/element-rendering',
  promptAssetPaths: ['cockpit/render/element-rendering/python/prompts/element-rendering.md'],
  codeAssetPaths: [
    'cockpit/render/element-rendering/angular/src/app/element-rendering.component.ts',
    'cockpit/render/element-rendering/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/render/element-rendering/python/src/graph.py',
  ],
  runtimeUrl: 'render/element-rendering',
  devPort: 4402,
};
