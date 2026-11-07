export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'deep-agents';
    section: 'core-capabilities';
    topic: 'planning';
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

export const deepAgentsPlanningPythonModule: CockpitCapabilityModule = {
  id: 'deep-agents-planning-python',
  manifestIdentity: {
    product: 'deep-agents',
    section: 'core-capabilities',
    topic: 'planning',
    page: 'overview',
    language: 'python',
  },
  title: 'Deep Agents Planning (Python)',
  docsPath: '/docs/angular/deep-agents/capabilities/planning',
  promptAssetPaths: ['cockpit/deep-agents/planning/python/prompts/planning.md'],
  codeAssetPaths: [
    'cockpit/deep-agents/planning/angular/src/app/planning.component.ts',
    'cockpit/deep-agents/planning/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/deep-agents/planning/python/src/graph.py',
  ],
  runtimeUrl: 'deep-agents/planning',
  devPort: 4310,
};
