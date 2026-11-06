import { docsNarrativeHref } from '@threadplane/cockpit-registry/docs-routes';
import { getDocByPath } from '../../../../../lib/docs';
import { getNarrativeDocuments } from '../../../../../lib/docs-catalog';
export function generateStaticParams() {
  return getNarrativeDocuments('shared').map((document) => ({
    slug: document.id.split('/'),
  }));
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await params;
  let pathname: string;
  try {
    pathname = docsNarrativeHref({ scope: 'shared', slug });
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const doc = getDocByPath(pathname);
  return new Response(doc?.content ?? 'Not found', {
    status: doc ? 200 : 404,
    headers: {
      'Content-Type': doc
        ? 'text/markdown; charset=utf-8'
        : 'text/plain; charset=utf-8',
      ...(doc
        ? { 'Cache-Control': 'public, max-age=60, must-revalidate' }
        : {}),
    },
  });
}
