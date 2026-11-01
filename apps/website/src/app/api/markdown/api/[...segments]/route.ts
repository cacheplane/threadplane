import {
  readApiIndex,
  readApiSymbol,
  resolveApiPage,
  apiSymbolMarkdown,
  apiIndexMarkdown,
} from '../../../../../lib/api-reference';

export function generateStaticParams() {
  const index = readApiIndex();
  return [
    ...index.entrypoints.map((entry) => ({ segments: entry.id.split('/') })),
    ...index.symbols.map((symbol) => ({
      segments: [...symbol.entrypointId.split('/'), symbol.name],
    })),
  ];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ segments: string[] }> }
) {
  const { segments } = await params;
  const page = resolveApiPage(segments, readApiIndex());
  if (page?.kind === 'index')
    return new Response(apiIndexMarkdown(readApiIndex(), page.entrypoint), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=60, must-revalidate',
      },
    });
  const symbol =
    page?.kind === 'symbol'
      ? readApiSymbol(page.entrypoint.id, page.symbol.name)
      : null;
  if (!symbol || page?.kind !== 'symbol')
    return new Response('Not found', { status: 404 });
  return new Response(apiSymbolMarkdown(symbol, page.entrypoint), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate',
    },
  });
}
