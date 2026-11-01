import { notFound } from 'next/navigation';
import { ApiReferencePage } from '../../../../components/docs/api/ApiReferencePage';
import {
  readApiIndex,
  resolveApiPage,
  apiPagePaths,
} from '../../../../lib/api-reference';
import { createPageMetadata } from '../../../../lib/site-metadata';

interface Props {
  params: Promise<{ segments: string[] }>;
}

export function generateStaticParams() {
  return apiPagePaths(readApiIndex())
    .filter((path) => path !== '/docs/api')
    .map((path) => ({
      segments: path
        .slice('/docs/api/'.length)
        .split('/')
        .map(decodeURIComponent),
    }));
}

export async function generateMetadata({ params }: Props) {
  const { segments } = await params;
  const page = resolveApiPage(segments, readApiIndex());
  if (!page) notFound();
  const title =
    page.kind === 'symbol'
      ? `${page.symbol.name} — ${page.entrypoint.importPath}`
      : page.entrypoint?.importPath ?? 'API Reference';
  return createPageMetadata({
    title: `${title} — Threadplane API`,
    description:
      page.kind === 'symbol' && page.symbol.summary
        ? page.symbol.summary.replace(/[`*_]/gu, '').slice(0, 155)
        : `API reference for ${page.entrypoint?.importPath ?? 'Threadplane'}.`,
    pathname: `/docs/api/${segments.map(encodeURIComponent).join('/')}`,
  });
}

export default async function ApiDetailPage({ params }: Props) {
  return <ApiReferencePage segments={(await params).segments} />;
}
