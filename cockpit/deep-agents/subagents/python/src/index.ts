export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'deep-agents';
    section: 'core-capabilities';
    topic: 'subagents';
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

export const deepAgentsSubagentsPythonModule: CockpitCapabilityModule = {
  id: 'deep-agents-subagents-python',
  manifestIdentity: {
    product: 'deep-agents',
    section: 'core-capabilities',
    topic: 'subagents',
    page: 'overview',
    language: 'python',
  },
  title: 'Deep Agents Subagents (Python)',
  docsPath: '/docs/angular/deep-agents/capabilities/subagents',
  promptAssetPaths: ['cockpit/deep-agents/subagents/python/prompts/subagents.md'],
  codeAssetPaths: [
    'cockpit/deep-agents/subagents/angular/src/app/subagents.component.ts',
    'cockpit/deep-agents/subagents/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/deep-agents/subagents/python/src/graph.py',
  ],
  runtimeUrl: 'deep-agents/subagents',
  devPort: 4312,
};
