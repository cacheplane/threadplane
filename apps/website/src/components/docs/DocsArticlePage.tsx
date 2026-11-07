import { notFound } from 'next/navigation';
import { MdxRenderer } from './MdxRenderer';
import { DocsSearch } from './DocsSearch';
import { DocsPageHeader } from './DocsPageHeader';
import { LibraryMark } from './LibraryMark';
import { PageActions } from './PageActions';
import { DocsPrevNext } from './DocsPrevNext';
import { DocsSearchFooter } from './DocsSearchFooter';
import { DocsTOC } from './DocsTOC';
import { JsonLd } from '../shared/JsonLd';
import { WebsiteWorkspace } from '../workspace/WebsiteWorkspace';
import { getDocByPath, resolveDocDescription } from '../../lib/docs';
import {
  getFrameworkDocuments,
  getNarrativeDocuments,
  getDocumentVariant,
} from '../../lib/docs-catalog';
import {
  getDocsSection,
  getLibraryConfig,
  type LibraryId,
} from '../../lib/docs-config';
import { breadcrumbJsonLd, techArticleJsonLd } from '../../lib/structured-data';
import { getDocLastModified } from '../../lib/sitemap-dates';
import { extractHeadings } from '../../lib/extract-headings';
import {
  getExampleCodeContext,
  getWebsiteWorkspacePage,
  getWebsiteDocumentResolution,
} from '../../lib/workspace-page';

/** One server-selected article, with the same identity in metadata, exports, and examples. */
export async function DocsArticlePage({ pathname }: { pathname: string }) {
  const doc = getDocByPath(pathname);
  if (!doc) notFound();
  const { document } = doc;
  const { library, section, slug, scope } = document;
  const framework = scope === 'shared' ? undefined : scope;
  const libConfig = library ? getLibraryConfig(library) : undefined;
  const libraryIntro = (
    framework
      ? getFrameworkDocuments(framework)
      : getNarrativeDocuments('shared')
  ).find((page) => page.library === library);
  const headings = extractHeadings(doc.body);
  const workspacePage = await getWebsiteWorkspacePage({
    docsPath: pathname,
    title: doc.title,
  });
  const frameworkTargets = Object.fromEntries(
    (['angular', 'react'] as const).flatMap((targetFramework) => {
      const target = getDocumentVariant(document.id, targetFramework);
      if (!target) return [];
      const targetDoc = getDocByPath(target.href);
      if (!targetDoc) return [];
      const targetResolution = getWebsiteDocumentResolution({
        docsPath: target.href,
        title: targetDoc.title,
      });
      return [
        [
          targetFramework,
          {
            href: target.href,
            modes:
              targetResolution.kind === 'mapped'
                ? targetResolution.identity.availableModes
                : ['Docs'],
            anchors: extractHeadings(targetDoc.body).map(
              (heading) => heading.id
            ),
          },
        ],
      ];
    })
  );
  const contextTrail = [
    { label: 'Docs', href: '/docs' },
    {
      label:
        framework === 'react'
          ? 'React'
          : framework === 'angular'
          ? 'Angular'
          : 'Shared',
    },
    ...(libConfig && libraryIntro
      ? [
          {
            label: libConfig.title,
            href: libraryIntro.href,
            icon: <LibraryMark library={library as LibraryId} size={20} />,
          },
        ]
      : []),
    {
      label:
        (library && getDocsSection(library, section)?.title) ||
        'Getting started',
    },
    { label: doc.title },
  ];
  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Docs', pathname: '/docs' },
    ...(libConfig && libraryIntro
      ? [{ name: libConfig.title, pathname: libraryIntro.href }]
      : []),
    { name: doc.title, pathname },
  ]);
  const articleData = techArticleJsonLd({
    title: doc.title,
    description: resolveDocDescription(doc),
    pathname,
    dateModified: getDocLastModified(pathname)?.toISOString(),
  });
  const docsSlot = (
    <div
      className="docs-workspace-article"
      data-docs-section={section}
      data-docs-framework={scope}
      data-learning-article={document.id === 'getting-started/workbench' || undefined}
    >
      <DocsSearch
        framework={framework}
        library={(library as LibraryId) ?? undefined}
      />
      <div className="flex min-w-0 docs-article-layout">
        <div className="flex-1 min-w-0">
          <div className="px-4 sm:px-6 md:px-12 md:max-w-3xl pt-6">
            <DocsPageHeader
              actions={
                <PageActions
                  documentPath={pathname.slice('/docs/'.length)}
                  source={document.source}
                  headings={headings}
                />
              }
            />
          </div>
          <article className="flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
            <MdxRenderer
              source={doc.body}
              exampleCode={getExampleCodeContext(workspacePage)}
              docsPath={pathname}
            />
          </article>
          <div className="px-4 sm:px-6 md:px-12 max-w-3xl pb-8">
            <DocsPrevNext document={document} />
          </div>
        </div>
        <DocsTOC headings={headings} />
      </div>
      <DocsSearchFooter />
    </div>
  );
  return (
    <>
      <JsonLd data={articleData} />
      <JsonLd data={breadcrumbs} />
      <WebsiteWorkspace
        {...workspacePage}
        routePath={pathname}
        framework={framework}
        docsSlot={docsSlot}
        contextTrail={contextTrail}
        docsContext={{
          scope,
          documentId: document.id,
          frameworkTargets,
          currentPath: pathname,
          activeLibrary: library as LibraryId | null,
          activeSection: section,
          activeSlug: slug,
        }}
      />
    </>
  );
}
