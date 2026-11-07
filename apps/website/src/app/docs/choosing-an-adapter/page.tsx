import fs from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';
import { DocsControlPlane } from '../../../components/docs/DocsControlPlane';
import { DocsSearch } from '../../../components/docs/DocsSearch';
import { MdxRenderer } from '../../../components/docs/MdxRenderer';
import { DocsTOC } from '../../../components/docs/DocsTOC';
import { createPageMetadata } from '../../../lib/site-metadata';
import { extractHeadings } from '../../../lib/extract-headings';
import { stripFrontmatter } from '../../../lib/docs';
import '../../../styles/docs-entry.css';

const PAGE_TITLE = 'Choosing an adapter';

export const metadata = createPageMetadata({
  title: 'Choosing an adapter — Threadplane',
  description: 'Decide between @threadplane/langgraph and @threadplane/ag-ui.',
  pathname: '/docs/choosing-an-adapter',
  type: 'website',
});

function resolveContentFile(): string | null {
  const candidates = [
    path.join(
      process.cwd(),
      'apps',
      'website',
      'content',
      'docs',
      'choosing-an-adapter',
      'index.mdx'
    ),
    path.join(
      process.cwd(),
      'content',
      'docs',
      'choosing-an-adapter',
      'index.mdx'
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export default function ChoosingAnAdapterPage() {
  const filePath = resolveContentFile();
  if (!filePath) notFound();

  const source = stripFrontmatter(fs.readFileSync(filePath, 'utf8'));
  const headings = extractHeadings(source);

  return (
    <div className="flex min-h-screen docs-shell-page">
      <DocsSearch />
      {/* This page is deliberately library-neutral: it is the page that helps
       * you pick one, so the picker opens with nothing selected. */}
      <DocsControlPlane activeLibrary={null} activeSection="" activeSlug="" />
      <div className="flex-1 flex min-w-0 docs-shell-body docs-entry-reading">
        <div className="flex-1 min-w-0">
          <article
            aria-label={PAGE_TITLE}
            className="flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl"
          >
            <MdxRenderer source={source} docsPath="/docs/choosing-an-adapter" />
          </article>
        </div>
        {/* This page carries as many headings as any library page, so it gets
         * the same rail. It stays library-neutral, so it takes no breadcrumb
         * or page header — both are keyed to a library it deliberately
         * has not picked. */}
        <DocsTOC headings={headings} />
      </div>
    </div>
  );
}
