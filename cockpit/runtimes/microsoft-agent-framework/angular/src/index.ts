export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'runtimes';
    section: 'core-capabilities';
    topic: 'microsoft-agent-framework';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const runtimesMicrosoftAgentFrameworkAngularModule: CockpitCapabilityModule = {
  id: 'runtimes-microsoft-agent-framework-angular',
  manifestIdentity: {
    product: 'runtimes',
    section: 'core-capabilities',
    topic: 'microsoft-agent-framework',
    page: 'overview',
    language: 'angular',
  },
  title: 'Runtimes — Microsoft Agent Framework (Angular)',
  docsPath: '/docs/angular/runtimes/microsoft-agent-framework/overview',
  promptAssetPaths: [
    'cockpit/runtimes/microsoft-agent-framework/angular/prompts/microsoft-agent-framework.md',
  ],
  codeAssetPaths: [
    'cockpit/runtimes/microsoft-agent-framework/angular/src/app/microsoft-agent-framework.component.ts',
    'cockpit/runtimes/microsoft-agent-framework/angular/src/app/app.config.ts',
  ],
};
