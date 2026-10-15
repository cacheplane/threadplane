export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'runtimes';
    section: 'core-capabilities';
    topic: 'aws-strands';
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

export const runtimesAwsStrandsPythonModule: CockpitCapabilityModule = {
  id: 'runtimes-aws-strands-python',
  manifestIdentity: {
    product: 'runtimes',
    section: 'core-capabilities',
    topic: 'aws-strands',
    page: 'overview',
    language: 'python',
  },
  title: 'Runtimes — AWS Strands (Python)',
  docsPath: '/docs/runtimes/aws-strands/overview',
  promptAssetPaths: ['cockpit/runtimes/aws-strands/python/prompts/aws-strands.md'],
  codeAssetPaths: [
    'cockpit/runtimes/aws-strands/angular/src/app/aws-strands.component.ts',
    'cockpit/runtimes/aws-strands/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/runtimes/aws-strands/python/src/agent.py',
    'cockpit/runtimes/aws-strands/python/src/server.py',
    'cockpit/runtimes/aws-strands/python/src/subagent_emitter.py',
  ],
  runtimeUrl: 'runtimes/aws-strands',
  devPort: 4331,
};
