export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'threads';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const chatThreadsAngularModule: CockpitCapabilityModule = {
  id: 'chat-threads-angular',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'threads',
    page: 'overview',
    language: 'angular',
  },
  title: 'Chat Threads (Angular)',
  docsPath: '/docs/angular/chat/guides/thread-routing',
  promptAssetPaths: ['cockpit/chat/threads/python/prompts/threads.md'],
  codeAssetPaths: ['cockpit/chat/threads/angular/src/app/threads.component.ts'],
};
