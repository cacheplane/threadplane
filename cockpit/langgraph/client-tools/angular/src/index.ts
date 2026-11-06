export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'langgraph';
    section: 'core-capabilities';
    topic: 'client-tools';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const langgraphClientToolsAngularModule: CockpitCapabilityModule = {
  id: 'langgraph-client-tools-angular',
  manifestIdentity: {
    product: 'langgraph',
    section: 'core-capabilities',
    topic: 'client-tools',
    page: 'overview',
    language: 'angular',
  },
  title: 'LangGraph Client Tools (Angular)',
  docsPath: '/docs/angular/chat/guides/client-tools',
  promptAssetPaths: [
    'cockpit/langgraph/client-tools/angular/prompts/client-tools.md',
  ],
  codeAssetPaths: [
    'cockpit/langgraph/client-tools/angular/src/app/client-tools.component.ts',
    'cockpit/langgraph/client-tools/angular/src/app/weather-card.component.ts',
    'cockpit/langgraph/client-tools/angular/src/app/confirm-booking.component.ts',
    'cockpit/langgraph/client-tools/angular/src/app/app.config.ts',
  ],
};
