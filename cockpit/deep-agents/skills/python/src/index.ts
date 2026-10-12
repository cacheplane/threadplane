export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'deep-agents';
    section: 'core-capabilities';
    topic: 'skills';
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

export const deepAgentsSkillsPythonModule: CockpitCapabilityModule = {
  id: 'deep-agents-skills-python',
  manifestIdentity: {
    product: 'deep-agents',
    section: 'core-capabilities',
    topic: 'skills',
    page: 'overview',
    language: 'python',
  },
  title: 'Deep Agents Skills (Python)',
  docsPath: '/docs/deep-agents/capabilities/skills',
  promptAssetPaths: ['cockpit/deep-agents/skills/python/prompts/skills.md'],
  codeAssetPaths: [
    'cockpit/deep-agents/skills/angular/src/app/skills.component.ts',
    'cockpit/deep-agents/skills/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/deep-agents/skills/python/src/graph.py',
    'cockpit/deep-agents/skills/python/src/skills_readonly.py',
    'cockpit/deep-agents/skills/python/skills/runway-analysis/SKILL.md',
    'cockpit/deep-agents/skills/python/skills/runway-analysis/reference/margins.md',
    'cockpit/deep-agents/skills/python/skills/weather-brief/SKILL.md',
  ],
  runtimeUrl: 'deep-agents/skills',
  devPort: 4314,
};
