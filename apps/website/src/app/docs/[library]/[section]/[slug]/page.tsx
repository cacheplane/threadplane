import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MdxRenderer } from '../../../../../components/docs/MdxRenderer';
import { ReactStreamingPreview } from '../../../../../components/docs/ReactStreamingPreview';
import { ReactInterruptsPreview } from '../../../../../components/docs/ReactInterruptsPreview';
import { ReactMemoryPreview } from '../../../../../components/docs/ReactMemoryPreview';
import { ReactClientToolsPreview } from '../../../../../components/docs/ReactClientToolsPreview';
import { ReactPersistencePreview } from '../../../../../components/docs/ReactPersistencePreview';
import { ReactDurableExecutionPreview } from '../../../../../components/docs/ReactDurableExecutionPreview';
import { ReactSubgraphsPreview } from '../../../../../components/docs/ReactSubgraphsPreview';
import { ReactTimeTravelPreview } from '../../../../../components/docs/ReactTimeTravelPreview';
import { ReactDeploymentRuntimePreview } from '../../../../../components/docs/ReactDeploymentRuntimePreview';
import { ReactAgUiStreamingPreview } from '../../../../../components/docs/ReactAgUiStreamingPreview';
import { ReactAgUiInterruptsPreview } from '../../../../../components/docs/ReactAgUiInterruptsPreview';
import { DocsSearch } from '../../../../../components/docs/DocsSearch';
import { DocsPageHeader } from '../../../../../components/docs/DocsPageHeader';
import { LibraryMark } from '../../../../../components/docs/LibraryMark';
import { PageActions } from '../../../../../components/docs/PageActions';
import { DocsPrevNext } from '../../../../../components/docs/DocsPrevNext';
import { DocsSearchFooter } from '../../../../../components/docs/DocsSearchFooter';
import {
  DEFAULT_DOCS_DESCRIPTION,
  getAllDocSlugs,
  getDocBySlug,
  getDocMetadata,
  resolveDocDescription,
} from '../../../../../lib/docs';
import { JsonLd } from '../../../../../components/shared/JsonLd';
import {
  breadcrumbJsonLd,
  techArticleJsonLd,
} from '../../../../../lib/structured-data';
import { getDocLastModified } from '../../../../../lib/sitemap-dates';
import {
  ApiDocRenderer,
  type ApiDocEntry,
} from '../../../../../components/docs/ApiDocRenderer';
import { DocsTOC } from '../../../../../components/docs/DocsTOC';
import { extractHeadings } from '../../../../../lib/extract-headings';
import {
  findDocsPage,
  getDocsSection,
  getLibraryConfig,
  libraryIntroPath,
  type LibraryId,
} from '../../../../../lib/docs-config';
import { WebsiteWorkspace } from '../../../../../components/workspace/WebsiteWorkspace';
import {
  getExampleCodeContext,
  getWebsiteWorkspacePage,
} from '../../../../../lib/workspace-page';
import fs from 'fs';
import path from 'path';

function loadApiDocs(library: string): ApiDocEntry[] {
  const candidates = [
    path.join(
      process.cwd(),
      'apps',
      'website',
      'content',
      'docs',
      library,
      'api',
      'api-docs.json'
    ),
    path.join(
      process.cwd(),
      'content',
      'docs',
      library,
      'api',
      'api-docs.json'
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return [];
}

interface DocsRouteProps {
  params: Promise<{ library: string; section: string; slug: string }>;
}

export function generateStaticParams() {
  return getAllDocSlugs().map(({ library, section, slug }) => ({
    library,
    section,
    slug,
  }));
}

export async function generateMetadata({
  params,
}: DocsRouteProps): Promise<Metadata> {
  const { library, section, slug } = await params;
  return (
    getDocMetadata(library, section, slug) ?? {
      title: 'Docs — Threadplane',
      description: DEFAULT_DOCS_DESCRIPTION,
    }
  );
}

export default async function DocsPage({ params }: DocsRouteProps) {
  const { library, section, slug } = await params;

  const libConfig = getLibraryConfig(library);
  if (!libConfig) notFound();

  const doc = getDocBySlug(library, section, slug);
  if (!doc) notFound();

  const pathname = `/docs/${library}/${section}/${slug}`;
  const headings = extractHeadings(doc.body);
  const workspacePage = await getWebsiteWorkspacePage({
    docsPath: pathname,
    title: doc.title,
  });

  const articleData = techArticleJsonLd({
    title: doc.title,
    // Exactly the string `generateMetadata` puts in the meta description.
    description: resolveDocDescription(doc, library),
    pathname,
    dateModified: getDocLastModified(pathname)?.toISOString(),
  });

  // Mirrors the visible trail the shell header renders from `contextTrail`,
  // which links the library rung through the same `libraryIntroPath()` — there
  // is no /docs/<library> route, so a crumb pointing there would 404.
  //
  // The section rung the visible trail shows between library and page is
  // deliberately absent: it is plain text there because no section index route
  // exists, and a non-final BreadcrumbList item with no `item` URL is invalid.
  // Omitting it is closer to the visible trail than inventing a URL for it.
  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Docs', pathname: '/docs' },
    { name: libConfig.title, pathname: libraryIntroPath(library) },
    { name: doc.title, pathname },
  ]);

  // The one visible trail on this page. The shell header renders it; nothing
  // else on the page restates it. Section titles come from docs-config, and
  // the section rung carries no href because there is no section index route.
  const contextTrail = [
    { label: 'Docs', href: '/docs' },
    {
      label: libConfig.title,
      href: libraryIntroPath(library),
      // 20, not the component's default 24: the trail's line box is ~20px
      // (13px text at 1.5), so a larger chip would grow the header row. The
      // logo inside is 60% of the chip, and at size 16 that left a 10px mark
      // in a 14px box, which read as a smudge rather than a logo.
      icon: <LibraryMark library={library as LibraryId} size={20} />,
    },
    { label: getDocsSection(library, section)?.title ?? section },
    { label: doc.title },
  ];

  const docsSlot = (
    <div className="docs-workspace-article">
      <DocsSearch library={library as LibraryId} />
      <div className="flex min-w-0 docs-article-layout">
        <div className="flex-1 min-w-0">
          {/* Same measure as the article and the prev/next rail below it, so the
           * whole column shares one right edge. Without md:max-w-3xl this
           * block stretched to the full content width and PageActions floated
           * ~500px right of the prose it belongs to (1272px vs 768px at
           * 1920). */}
          <div className="px-4 sm:px-6 md:px-12 md:max-w-3xl pt-6">
            <DocsPageHeader
              actions={
                <PageActions
                  library={library}
                  section={section}
                  slug={slug}
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
          {section === 'api' &&
            (() => {
              const entries = loadApiDocs(library);
              const target = doc.title.replace(/\(\)$/, '');
              const byName = (name: string) =>
                entries.find((e: ApiDocEntry) => e.name === name);

              // A page normally documents the one export named by its H1. Pages
              // covering a group of exports declare them via `apiEntries`.
              const configured = findDocsPage(
                library,
                section,
                slug
              )?.apiEntries;
              const rendered = configured
                ? configured
                    .map(byName)
                    .filter((e): e is ApiDocEntry => Boolean(e))
                : [byName(target) ?? byName(doc.title)].filter(
                    (e): e is ApiDocEntry => Boolean(e)
                  );

              return rendered.length > 0 ? (
                <div className="px-4 sm:px-6 md:px-12 max-w-3xl pb-8">
                  {rendered.map((entry) => (
                    <ApiDocRenderer key={entry.name} entry={entry} />
                  ))}
                </div>
              ) : null;
            })()}
          <div className="px-4 sm:px-6 md:px-12 max-w-3xl pb-8">
            <DocsPrevNext
              library={library as LibraryId}
              section={section}
              slug={slug}
            />
          </div>
        </div>
        <DocsTOC headings={headings} />
      </div>
      {/* Sibling to docs-article-layout, not nested inside its article column:
       * that column excludes the TOC rail's width, so a full-width band placed
       * inside it would be narrower than the scrollable docs-workspace-article
       * area it should span. This is as wide as that area gets without
       * restructuring the layout further. */}
      <DocsSearchFooter />
    </div>
  );

  return (
    <>
      <JsonLd data={articleData} />
      <JsonLd data={breadcrumbs} />
      <WebsiteWorkspace
        resolution={workspacePage.resolution}
        presentation={workspacePage.presentation}
        // Raw sources exist only for the server-rendered `<ExampleCode>` above
        // (docsSlot already captured them); the workspace shell renders the
        // highlighted `codeFiles`, so shipping them again would only add dead
        // weight to this client boundary's RSC payload.
        contentBundle={{ ...workspacePage.contentBundle, codeSources: {} }}
        frontendVariants={
          workspacePage.frontendVariants?.react
            ? {
                react: {
                  ...workspacePage.frontendVariants.react,
                  contentBundle: {
                    ...workspacePage.frontendVariants.react.contentBundle,
                    codeSources: {},
                  },
                },
              }
            : undefined
        }
        reactDocsSlot={
          workspacePage.frontendVariants?.react &&
          (library === 'langgraph' ||
            (library === 'ag-ui' && ((section === 'reference' && slug === 'event-mapping') || (section === 'guides' && slug === 'interrupts'))) ||
            (library === 'chat' && slug === 'client-tools')) ? (
            library === 'ag-ui' ? (
              slug === 'interrupts' ? <ReactAgUiInterruptsPreview exampleCode={getExampleCodeContext(workspacePage.frontendVariants.react)} /> :
              <ReactAgUiStreamingPreview exampleCode={getExampleCodeContext(workspacePage.frontendVariants.react)} />
            ) : library === 'chat' && slug === 'client-tools' ? (
              <ReactClientToolsPreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'streaming' ? (
              <ReactStreamingPreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'interrupts' ? (
              <ReactInterruptsPreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'memory' ? (
              <ReactMemoryPreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'persistence' ? (
              <ReactPersistencePreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'durable-execution' ? (
              <ReactDurableExecutionPreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'subgraphs' ? (
              <ReactSubgraphsPreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'time-travel' ? (
              <ReactTimeTravelPreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : slug === 'deployment' ? (
              <ReactDeploymentRuntimePreview
                exampleCode={getExampleCodeContext(
                  workspacePage.frontendVariants.react
                )}
              />
            ) : undefined
          ) : undefined
        }
        navigationTree={workspacePage.navigationTree}
        routePath={pathname}
        docsSlot={docsSlot}
        contextTrail={contextTrail}
        docsContext={{
          activeLibrary: library as LibraryId,
          activeSection: section,
          activeSlug: slug,
        }}
      />
    </>
  );
}
