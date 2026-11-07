export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'a2ui';
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

export const chatA2uiPythonModule: CockpitCapabilityModule = {
  id: 'chat-a2ui-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'a2ui',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat A2UI (Python)',
  docsPath: '/docs/angular/chat/a2ui/overview',
  promptAssetPaths: ['cockpit/chat/a2ui/python/prompts/a2ui.md'],
  codeAssetPaths: [
    'cockpit/chat/a2ui/angular/src/app/a2ui.component.ts',
    'cockpit/chat/a2ui/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/a2ui/python/src/graph.py',
  ],
  runtimeUrl: 'chat/a2ui',
  devPort: 4511,
};
