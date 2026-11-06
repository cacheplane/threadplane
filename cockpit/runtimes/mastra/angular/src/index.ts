export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'runtimes';
    section: 'core-capabilities';
    topic: 'mastra';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
  backendAssetPaths: string[];
  runtimeUrl?: string;
  devPort?: number;
}

export const runtimesMastraAngularModule: CockpitCapabilityModule = {
  id: 'runtimes-mastra-angular',
  manifestIdentity: {
    product: 'runtimes',
    section: 'core-capabilities',
    topic: 'mastra',
    page: 'overview',
    language: 'angular',
  },
  title: 'Runtimes — Mastra (Angular)',
  docsPath: '/docs/angular/runtimes/mastra/overview',
  promptAssetPaths: [
    'cockpit/runtimes/mastra/angular/prompts/mastra-backend.md',
    'cockpit/runtimes/mastra/angular/prompts/mastra.md',
  ],
  codeAssetPaths: [
    'cockpit/runtimes/mastra/angular/src/app/mastra.component.ts',
    'cockpit/runtimes/mastra/angular/src/app/app.config.ts',
  ],
  // The Mastra backend is the Node AG-UI service, not a cockpit/ Python
  // lane — these paths intentionally point outside cockpit/ (the cockpit
  // app reads workspace-root-relative paths and its file tracing stages
  // this directory explicitly).
  backendAssetPaths: [
    'deployments/ag-ui-mastra/agents.mjs',
    'deployments/ag-ui-mastra/server.mjs',
  ],
  runtimeUrl: 'runtimes/mastra',
  devPort: 4332,
};
