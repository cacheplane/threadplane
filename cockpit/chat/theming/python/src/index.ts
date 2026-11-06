export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'theming';
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

export const chatThemingPythonModule: CockpitCapabilityModule = {
  id: 'chat-theming-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'theming',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat Theming (Python)',
  docsPath: '/docs/angular/chat/guides/theming',
  promptAssetPaths: ['cockpit/chat/theming/python/prompts/theming.md'],
  codeAssetPaths: [
    'cockpit/chat/theming/angular/src/app/theming.component.ts',
    'cockpit/chat/theming/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/theming/python/src/graph.py',
  ],
  runtimeUrl: 'chat/theming',
  devPort: 4510,
};
