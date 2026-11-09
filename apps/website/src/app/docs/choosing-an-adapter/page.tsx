import { notFound } from 'next/navigation';
import { WebsiteWorkspace } from '../../../components/workspace/WebsiteWorkspace';
import { getWebsiteWorkspacePage } from '../../../lib/workspace-page';
import { DocsPageHeader } from '../../../components/docs/DocsPageHeader';
import { PageActions } from '../../../components/docs/PageActions';
import { MdxRenderer } from '../../../components/docs/MdxRenderer';
import { DocsTOC } from '../../../components/docs/DocsTOC';
import { createPageMetadata } from '../../../lib/site-metadata';
import { extractHeadings } from '../../../lib/extract-headings';
import { getSpecialDocByPath } from '../../../lib/docs';
import '../../../styles/docs-entry.css';

const PAGE_TITLE = 'Choosing an adapter';

export const metadata = createPageMetadata({
  title: 'Choosing an adapter — Threadplane',
  description: 'Decide between @threadplane/langgraph and @threadplane/ag-ui.',
  pathname: '/docs/choosing-an-adapter',
  type: 'website',
});

export default async function ChoosingAnAdapterPage() {
  const doc = getSpecialDocByPath('/docs/choosing-an-adapter');
  if (!doc) notFound();

  const source = doc.body;
  const headings = extractHeadings(source);
  const workspace = await getWebsiteWorkspacePage({
    docsPath: '/docs/choosing-an-adapter',
    title: PAGE_TITLE,
  });

  const docsSlot = (
    <div className="docs-workspace-article docs-entry-reading">
      <div className="flex min-w-0 docs-article-layout">
        <div className="flex-1 min-w-0">
          <div className="px-4 sm:px-6 md:px-12 md:max-w-3xl pt-6">
            <DocsPageHeader
              actions={
                <PageActions
                  documentPath="choosing-an-adapter"
                  source={doc.contentPath}
                  headings={headings}
                />
              }
            />
          </div>
          <article
            aria-label={PAGE_TITLE}
            className="flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl"
          >
            <MdxRenderer source={source} docsPath="/docs/choosing-an-adapter" />
          </article>
        </div>
        <DocsTOC headings={headings} />
      </div>
    </div>
  );
  return (
    <WebsiteWorkspace
      {...workspace}
      routePath="/docs/choosing-an-adapter"
      docsSlot={docsSlot}
      contextTrail={[{ label: 'Docs', href: '/docs' }, { label: PAGE_TITLE }]}
      docsContext={{
        scope: 'shared',
        currentPath: '/docs/choosing-an-adapter',
        activeLibrary: null,
        activeSection: '',
        activeSlug: '',
      }}
    />
  );
}
