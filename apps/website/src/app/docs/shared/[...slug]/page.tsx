import { docsNarrativeHref } from '@threadplane/cockpit-registry/docs-routes';
import { notFound } from 'next/navigation';
import { DocsArticlePage } from '../../../../components/docs/DocsArticlePage';
import { getNarrativeDocuments } from '../../../../lib/docs-catalog';
import { getDocMetadataByPath } from '../../../../lib/docs';
interface Props {
  params: Promise<{ slug: string[] }>;
}
export function generateStaticParams() {
  return getNarrativeDocuments('shared').map((document) => ({
    slug: document.id.split('/'),
  }));
}
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  let pathname: string;
  try {
    pathname = docsNarrativeHref({ scope: 'shared', slug });
  } catch {
    notFound();
  }
  const metadata = getDocMetadataByPath(pathname);
  if (!metadata) notFound();
  return metadata;
}
export default async function Page({ params }: Props) {
  const { slug } = await params;
  let pathname: string;
  try {
    pathname = docsNarrativeHref({ scope: 'shared', slug });
  } catch {
    notFound();
  }
  return DocsArticlePage({ pathname });
}
