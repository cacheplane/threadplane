export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'deep-agents';
    section: 'core-capabilities';
    topic: 'filesystem';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const deepAgentsFilesystemAngularModule: CockpitCapabilityModule = {
  id: 'deep-agents-filesystem-angular',
  manifestIdentity: {
    product: 'deep-agents',
    section: 'core-capabilities',
    topic: 'filesystem',
    page: 'overview',
    language: 'angular',
  },
  title: 'Deep Agents Filesystem (Angular)',
  docsPath: '/docs/angular/deep-agents/capabilities/filesystem',
  promptAssetPaths: [
    'cockpit/deep-agents/filesystem/angular/prompts/filesystem.md',
  ],
  codeAssetPaths: [
    'cockpit/deep-agents/filesystem/angular/src/app/filesystem.component.ts',
    'cockpit/deep-agents/filesystem/angular/src/app/app.config.ts',
  ],
};
