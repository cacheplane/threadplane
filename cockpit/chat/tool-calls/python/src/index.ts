export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'tool-calls';
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

export const chatToolCallsPythonModule: CockpitCapabilityModule = {
  id: 'chat-tool-calls-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'tool-calls',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat Tool Calls (Python)',
  docsPath: '/docs/angular/chat/components/chat-tool-calls',
  promptAssetPaths: ['cockpit/chat/tool-calls/python/prompts/tool-calls.md'],
  codeAssetPaths: [
    'cockpit/chat/tool-calls/angular/src/app/tool-calls.component.ts',
    'cockpit/chat/tool-calls/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/tool-calls/python/src/graph.py',
  ],
  runtimeUrl: 'chat/tool-calls',
  devPort: 4504,
};
