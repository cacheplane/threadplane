export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'messages';
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

export const chatMessagesPythonModule: CockpitCapabilityModule = {
  id: 'chat-messages-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'messages',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat Messages (Python)',
  docsPath: '/docs/angular/chat/concepts/message-model',
  promptAssetPaths: ['cockpit/chat/messages/python/prompts/messages.md'],
  codeAssetPaths: [
    'cockpit/chat/messages/angular/src/app/messages.component.ts',
    'cockpit/chat/messages/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/messages/python/src/graph.py',
  ],
  runtimeUrl: 'chat/messages',
  devPort: 4501,
};
