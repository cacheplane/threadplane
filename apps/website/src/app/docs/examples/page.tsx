import { WebsiteWorkspace } from '../../../components/workspace/WebsiteWorkspace';
import { getWebsiteWorkspacePage } from '../../../lib/workspace-page';
import { createPageMetadata } from '../../../lib/site-metadata';

export const metadata = createPageMetadata({
  title: 'Examples — Threadplane',
  description: 'Explore runnable Angular and React agent examples.',
  pathname: '/docs/examples',
});

export default async function ExamplesPage() {
  const workspace = await getWebsiteWorkspacePage({
    docsPath: '/docs/examples',
    title: 'Examples',
  });
  return (
    <WebsiteWorkspace
      {...workspace}
      routePath="/docs/examples"
      defaultMode="Run"
      docsSlot={workspace.runFallbackSlot}
      contextTrail={[{ label: 'Docs', href: '/docs' }, { label: 'Examples' }]}
      docsContext={{
        scope: 'shared',
        currentPath: '/docs/examples',
        activeLibrary: null,
        activeSection: '',
        activeSlug: '',
      }}
    />
  );
}
