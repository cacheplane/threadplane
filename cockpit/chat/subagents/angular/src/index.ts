export interface CockpitCapabilityModule {
  id: string;
  manifestIdentity: {
    product: 'chat';
    section: 'core-capabilities';
    topic: 'subagents';
    page: 'overview';
    language: 'angular';
  };
  title: string;
  docsPath: string;
  promptAssetPaths: string[];
  codeAssetPaths: string[];
}

export const chatSubagentsAngularModule: CockpitCapabilityModule = {
  id: 'chat-subagents-angular',
  manifestIdentity: {
    product: 'chat',
    section: 'core-capabilities',
    topic: 'subagents',
    page: 'overview',
    language: 'angular',
  },
  title: 'Chat Subagents (Angular)',
  docsPath: '/docs/angular/chat/components/chat-subagent-card',
  promptAssetPaths: ['cockpit/chat/subagents/python/prompts/subagents.md'],
  codeAssetPaths: ['cockpit/chat/subagents/angular/src/app/subagents.component.ts'],
};
