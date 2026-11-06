export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'render';
    section: 'core-capabilities';
    topic: 'spec-rendering';
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

export const renderSpecRenderingPythonModule: CockpitCapabilityModule = {
  id: 'render-spec-rendering-python',
  manifestIdentity: {
    product: 'render',
    section: 'core-capabilities',
    topic: 'spec-rendering',
    page: 'overview',
    language: 'python',
  },
  title: 'Render Spec Rendering (Python)',
  docsPath: '/docs/angular/render/guides/specs',
  promptAssetPaths: ['cockpit/render/spec-rendering/python/prompts/spec-rendering.md'],
  codeAssetPaths: [
    'cockpit/render/spec-rendering/angular/src/app/spec-rendering.component.ts',
    'cockpit/render/spec-rendering/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/render/spec-rendering/python/src/graph.py',
  ],
  runtimeUrl: 'render/spec-rendering',
  devPort: 4401,
};
