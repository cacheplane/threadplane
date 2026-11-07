import { getWebsiteWorkspacePage } from '../../lib/workspace-page';
import { LiveLearningWorkbench } from './LiveLearningWorkbench';

/** Resolve runtime metadata on the server, as the surrounding docs workspace does. */
export async function LearningWorkbenchEmbed({
  framework,
}: {
  readonly framework: 'angular' | 'react';
}) {
  const model = await getWebsiteWorkspacePage({
    docsPath: `/docs/${framework}/langgraph/guides/streaming`,
    title: 'Streaming',
  });
  return (
    <LiveLearningWorkbench
      framework={framework}
      runtimeUrl={model.contentBundle.runtimeUrl}
      capability={
        model.resolution.kind === 'mapped'
          ? model.resolution.identity.id
          : 'langgraph-streaming'
      }
    />
  );
}
