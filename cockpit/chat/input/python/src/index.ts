export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'input';
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

export const chatInputPythonModule: CockpitCapabilityModule = {
  id: 'chat-input-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'input',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat Input (Python)',
  docsPath: '/docs/angular/chat/components/chat-input',
  promptAssetPaths: ['cockpit/chat/input/python/prompts/input.md'],
  codeAssetPaths: [
    'cockpit/chat/input/angular/src/app/input.component.ts',
    'cockpit/chat/input/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/input/python/src/graph.py',
  ],
  runtimeUrl: 'chat/input',
  devPort: 4502,
};
