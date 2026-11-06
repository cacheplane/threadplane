export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'time-travel';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const langgraphTimeTravelAngularModule: CockpitCapabilityModule = {
  id: 'langgraph-time-travel-angular',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'time-travel',
    page: 'overview',
    language: 'angular',
  },
  title: 'LangGraph Time Travel (Angular)',
  docsPath: '/docs/angular/langgraph/guides/time-travel',
  promptAssetPaths: [
    'cockpit/langgraph/time-travel/angular/prompts/time-travel.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/time-travel/angular/src/app.component.ts',
  ],
};
