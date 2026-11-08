export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'deep-agents';
    section: 'core-capabilities';
    topic: 'planning';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const deepAgentsPlanningAngularModule: CockpitCapabilityModule = {
  id: 'deep-agents-planning-angular',
  manifestIdentity: {
    product: 'deep-agents',
    section: 'core-capabilities',
    topic: 'planning',
    page: 'overview',
    language: 'angular',
  },
  title: 'Deep Agents Planning (Angular)',
  docsPath: '/docs/angular/deep-agents/capabilities/planning',
  promptAssetPaths: [
    'cockpit/deep-agents/planning/angular/prompts/planning.md',
  ],
  codeAssetPaths: [
    'cockpit/deep-agents/planning/angular/src/app/planning.component.ts',
    'cockpit/deep-agents/planning/angular/src/app/app.config.ts',
  ],
};
