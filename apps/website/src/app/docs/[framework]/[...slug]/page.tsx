import {
  docsNarrativeHref,
  type DocsFramework,
} from '@threadplane/cockpit-registry/docs-routes';
import { notFound } from 'next/navigation';
import { DocsArticlePage } from '../../../../components/docs/DocsArticlePage';
import { getNarrativeDocuments } from '../../../../lib/docs-catalog';
import { getDocMetadataByPath } from '../../../../lib/docs';
interface Props {
  params: Promise<{ framework: string; slug: string[] }>;
}
export function generateStaticParams() {
  return getNarrativeDocuments()
    .filter((document) => document.scope !== 'shared')
    .map((document) => ({
      framework: document.scope,
      slug: document.id.split('/'),
    }));
}
export async function generateMetadata({ params }: Props) {
  const { framework, slug } = await params;
  let pathname: string;
  try {
    pathname = docsNarrativeHref({
      scope: 'framework',
      framework: framework as DocsFramework,
      slug,
    });
  } catch {
    notFound();
  }
  const metadata = getDocMetadataByPath(pathname);
  if (!metadata) notFound();
  return metadata;
}
export default async function Page({ params }: Props) {
  const { framework, slug } = await params;
  let pathname: string;
  try {
    pathname = docsNarrativeHref({
      scope: 'framework',
      framework: framework as DocsFramework,
      slug,
    });
  } catch {
    notFound();
  }
  return DocsArticlePage({ pathname });
}
