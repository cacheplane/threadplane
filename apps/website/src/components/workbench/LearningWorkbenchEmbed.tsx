import { getWebsiteWorkspacePage } from '../../lib/workspace-page';
import { LiveLearningWorkbench } from './LiveLearningWorkbench';
import { createLearningSource } from './learning-source';

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
  // Next resolves this once in next.config.ts for the docs build identity.
  const revision = process.env['THREADPLANE_DOCS_BUILD_REVISION'];
  if (!revision)
    throw new Error('Learning workbench requires the docs build revision.');
  return (
    <LiveLearningWorkbench
      framework={framework}
      source={createLearningSource(
        framework,
        model.contentBundle.codeSources,
        revision
      )}
      runtimeUrl={model.contentBundle.runtimeUrl}
      capability={
        model.resolution.kind === 'mapped'
          ? model.resolution.identity.id
          : 'langgraph-streaming'
      }
    />
  );
}
