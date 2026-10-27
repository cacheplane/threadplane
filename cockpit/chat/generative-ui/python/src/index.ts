export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'generative-ui';
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

export const chatGenerativeUiPythonModule: CockpitCapabilityModule = {
  id: 'chat-generative-ui-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'generative-ui',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat Generative UI (Python)',
  docsPath: '/docs/chat/guides/generative-ui',
  promptAssetPaths: ['cockpit/chat/generative-ui/python/prompts/generative-ui.md'],
  codeAssetPaths: [
    'cockpit/chat/generative-ui/angular/src/app/generative-ui.component.ts',
    'cockpit/chat/generative-ui/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/generative-ui/python/src/graph.py',
    'cockpit/chat/generative-ui/python/src/dashboard_tools.py',
    'cockpit/chat/generative-ui/python/src/operations.py',
    'cockpit/chat/generative-ui/python/src/dashboard_contract.py',
  ],
  runtimeUrl: 'chat/generative-ui',
  devPort: 4508,
};
