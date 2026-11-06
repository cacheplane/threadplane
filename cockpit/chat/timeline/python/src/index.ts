export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'timeline';
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

export const chatTimelinePythonModule: CockpitCapabilityModule = {
  id: 'chat-timeline-python',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'timeline',
    page: 'overview',
    language: 'python',
  },
  title: 'Chat Timeline (Python)',
  docsPath: '/docs/angular/chat/components/chat-trace',
  promptAssetPaths: ['cockpit/chat/timeline/python/prompts/timeline.md'],
  codeAssetPaths: [
    'cockpit/chat/timeline/angular/src/app/timeline.component.ts',
    'cockpit/chat/timeline/angular/src/app/app.config.ts',
  ],
  backendAssetPaths: [
    'cockpit/chat/timeline/python/src/graph.py',
  ],
  runtimeUrl: 'chat/timeline',
  devPort: 4507,
};
