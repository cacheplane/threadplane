import { getSpecialDocByPath } from '../../../../lib/docs';

export function GET() {
  const doc = getSpecialDocByPath('/docs/choosing-an-adapter');
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
