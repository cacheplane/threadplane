export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'runtimes';
    section: 'core-capabilities';
    topic: 'microsoft-agent-framework';
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

export const runtimesMicrosoftAgentFrameworkPythonModule: CockpitCapabilityModule = {
  id: 'runtimes-microsoft-agent-framework-python',
  manifestIdentity: {
    product: 'runtimes',
    section: 'core-capabilities',
    topic: 'microsoft-agent-framework',
    page: 'overview',
    language: 'python',
  },
  title: 'Runtimes — Microsoft Agent Framework (Python)',
  docsPath: '/docs/runtimes/microsoft-agent-framework/overview',
  promptAssetPaths: ['cockpit/runtimes/microsoft-agent-framework/python/prompts/microsoft-agent-framework.md'],
  codeAssetPaths: [
    'cockpit/runtimes/microsoft-agent-framework/angular/src/app/microsoft-agent-framework.component.ts',
    'cockpit/runtimes/microsoft-agent-framework/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/runtimes/microsoft-agent-framework/python/src/agent.py',
    'cockpit/runtimes/microsoft-agent-framework/python/src/server.py',
  ],
  runtimeUrl: 'runtimes/microsoft-agent-framework',
  devPort: 4330,
};
