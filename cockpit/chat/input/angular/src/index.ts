export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'input';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const chatInputAngularModule: CockpitCapabilityModule = {
  id: 'chat-input-angular',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'input',
    page: 'overview',
    language: 'angular',
  },
  title: 'Chat Input (Angular)',
  docsPath: '/docs/angular/chat/components/chat-input',
  promptAssetPaths: ['cockpit/chat/input/python/prompts/input.md'],
  codeAssetPaths: ['cockpit/chat/input/angular/src/app/input.component.ts'],
};
