import { apiIndexMarkdown, readApiIndex } from '../../../../lib/api-reference';

export function GET() {
  return new Response(apiIndexMarkdown(readApiIndex()), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate',
    },
  });
}
