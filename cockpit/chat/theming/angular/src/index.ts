export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'theming';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const chatThemingAngularModule: CockpitCapabilityModule = {
  id: 'chat-theming-angular',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'theming',
    page: 'overview',
    language: 'angular',
  },
  title: 'Chat Theming (Angular)',
  docsPath: '/docs/angular/chat/guides/theming',
  promptAssetPaths: ['cockpit/chat/theming/python/prompts/theming.md'],
  codeAssetPaths: ['cockpit/chat/theming/angular/src/app/theming.component.ts'],
};
