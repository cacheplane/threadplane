export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'deep-agents';
    section: 'core-capabilities';
    topic: 'skills';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const deepAgentsSkillsAngularModule: CockpitCapabilityModule = {
  id: 'deep-agents-skills-angular',
  manifestIdentity: {
    product: 'deep-agents',
    section: 'core-capabilities',
    topic: 'skills',
    page: 'overview',
    language: 'angular',
  },
  title: 'Deep Agents Skills (Angular)',
  docsPath: '/docs/angular/deep-agents/capabilities/skills',
  promptAssetPaths: [
    'cockpit/deep-agents/skills/angular/prompts/skills.md',
  ],
  codeAssetPaths: [
    'cockpit/deep-agents/skills/angular/src/app/skills.component.ts',
    'cockpit/deep-agents/skills/angular/src/app/app.config.ts',
  ],
};
