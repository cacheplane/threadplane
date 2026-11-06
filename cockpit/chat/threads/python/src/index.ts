export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'threads';
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

export const chatThreadsPythonModule: CockpitCapabilityModule = {
  id: 'chat-threads-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'threads',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat Threads (Python)',
  docsPath: '/docs/angular/chat/guides/thread-routing',
  promptAssetPaths: ['cockpit/chat/threads/python/prompts/threads.md'],
  codeAssetPaths: [
    'cockpit/chat/threads/angular/src/app/threads.component.ts',
    'cockpit/chat/threads/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/threads/python/src/graph.py',
  ],
  runtimeUrl: 'chat/threads',
  devPort: 4506,
};
