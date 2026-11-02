import { notFound } from 'next/navigation';
import {
  readApiIndex,
  readApiSymbol,
  resolveApiPage,
} from '../../../lib/api-reference';
import { getWebsiteWorkspacePage } from '../../../lib/workspace-page';
import { WebsiteWorkspace } from '../../workspace/WebsiteWorkspace';
import { DocsSearch } from '../DocsSearch';
import { ApiIndexView } from './ApiIndexView';
import { ApiSymbolView } from './ApiSymbolView';
import { JsonLd } from '../../shared/JsonLd';
import { breadcrumbJsonLd } from '../../../lib/structured-data';

/** Register reference pages with the site's persistent docs workspace. */
export async function ApiReferencePage({
  segments = [],
}: {
  segments?: string[];
}) {
  const index = readApiIndex();
  const page = resolveApiPage(segments, index);
  if (!page) notFound();
  const pathname = `/docs/api${
    segments.length ? `/${segments.map(encodeURIComponent).join('/')}` : ''
  }`;
  const symbol =
    page.kind === 'symbol'
      ? readApiSymbol(page.entrypoint.id, page.symbol.name)
      : null;
  if (page.kind === 'symbol' && !symbol) notFound();
  const title = symbol?.name ?? page.entrypoint?.importPath ?? 'API Reference';
  const workspace = await getWebsiteWorkspacePage({
    docsPath: pathname,
    title,
  });
  const entrypoint = page.entrypoint;
  const contextTrail = [
    { label: 'Docs', href: '/docs' },
    {
      label: 'API Reference',
      ...(segments.length ? { href: '/docs/api' } : {}),
    },
    ...(entrypoint
      ? [
          {
            label: entrypoint.importPath,
            ...(symbol ? { href: `/docs/api/${entrypoint.id}` } : {}),
          },
        ]
      : []),
    ...(symbol ? [{ label: symbol.name }] : []),
  ];
  const docsSlot = (
    <div className="docs-workspace-article">
      <DocsSearch />
      <div className="api-reference-page">
        {symbol && entrypoint ? (
          <ApiSymbolView symbol={symbol} entrypoint={entrypoint} />
        ) : (
          <article>
            <p className="api-reference-eyebrow">Threadplane SDK</p>
            <h1>{title}</h1>
            <p>
              Explore the exported APIs for Angular, React, and shared
              TypeScript libraries.
            </p>
            <div className="api-reference-actions">
              <a
                href={`/api/markdown/api${
                  entrypoint ? `/${entrypoint.id}` : ''
                }`}
              >
                View Markdown
              </a>
            </div>
            {entrypoint?.status === 'development' ? (
              <div className="api-reference-notice">
                <strong>Unpublished development API.</strong> This package is
                under development.
              </div>
            ) : null}
            {entrypoint &&
            !index.symbols.some(
              (item) => item.entrypointId === entrypoint.id
            ) ? (
              <p>This reserved entrypoint has no exported declarations.</p>
            ) : null}
            <ApiIndexView
              key={entrypoint?.id ?? 'all'}
              index={index}
              entrypointId={entrypoint?.id}
            />
          </article>
        )}
      </div>
    </div>
  );
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Docs', pathname: '/docs' },
          { name: 'API Reference', pathname: '/docs/api' },
          ...(entrypoint
            ? [
                {
                  name: entrypoint.importPath,
                  pathname: `/docs/api/${entrypoint.id}`,
                },
              ]
            : []),
          ...(symbol ? [{ name: symbol.name, pathname: symbol.href }] : []),
        ])}
      />
      <WebsiteWorkspace
        {...workspace}
        routePath={pathname}
        docsSlot={docsSlot}
        contextTrail={contextTrail}
        docsContext={{
          activeLibrary: null,
          activeSection: 'api',
          activeSlug: segments.at(-1) ?? '',
          apiContext: {
            entrypoints: index.entrypoints,
            symbols: index.symbols.filter(
              (item) => item.entrypointId === entrypoint?.id
            ),
            activeHref: pathname,
          },
        }}
      />
    </>
  );
}
