export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'runtimes';
    section: 'core-capabilities';
    topic: 'aws-strands';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const runtimesAwsStrandsAngularModule: CockpitCapabilityModule = {
  id: 'runtimes-aws-strands-angular',
  manifestIdentity: {
    product: 'runtimes',
    section: 'core-capabilities',
    topic: 'aws-strands',
    page: 'overview',
    language: 'angular',
  },
  title: 'Runtimes — AWS Strands (Angular)',
  docsPath: '/docs/angular/runtimes/aws-strands/overview',
  promptAssetPaths: [
    'cockpit/runtimes/aws-strands/angular/prompts/aws-strands.md',
  ],
  codeAssetPaths: [
    'cockpit/runtimes/aws-strands/angular/src/app/aws-strands.component.ts',
    'cockpit/runtimes/aws-strands/angular/src/app/app.config.ts',
  ],
};
