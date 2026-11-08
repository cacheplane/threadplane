export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'debug';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const chatDebugAngularModule: CockpitCapabilityModule = {
  id: 'chat-debug-angular',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'debug',
    page: 'overview',
    language: 'angular',
  },
  title: 'Chat Debug (Angular)',
  docsPath: '/docs/angular/chat/components/chat-debug',
  promptAssetPaths: ['cockpit/chat/debug/python/prompts/debug.md'],
  codeAssetPaths: ['cockpit/chat/debug/angular/src/app/debug.component.ts'],
};
