import Link from 'next/link';
import { Card } from '../ui/Card';
import { Eyebrow } from '../ui/Eyebrow';
import { getLibraryConfig, type LibraryId } from '../../lib/docs-config';

interface Props {
  library: LibraryId;
  section: string;
  slug: string;
}

interface Sibling {
  href: string;
  section: string;
  slug: string;
  title: string;
}

function findSiblings(library: LibraryId, section: string, slug: string): { prev: Sibling | null; next: Sibling | null } {
  const lib = getLibraryConfig(library);
  if (!lib) return { prev: null, next: null };
  // Flatten pages in declaration order.
  const flat: Sibling[] = [];
  for (const s of lib.sections) {
    for (const p of s.pages) {
      flat.push({
        section: p.section,
        slug: p.slug,
        title: p.title,
        href: p.href ?? `/docs/${library}/${p.section}/${p.slug}`,
      });
    }
  }
  const idx = flat.findIndex((p) => p.section === section && p.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
  };
}

export function DocsPrevNext({ library, section, slug }: Props) {
  const { prev, next } = findSiblings(library, section, slug);
  if (!prev && !next) return null;

  return (
    <nav
      aria-label="Previous and next page"
      className="docs-prevnext"
    >
      {prev ? (
        <Link href={prev.href} className="docs-prevnext-link">
          <Card padding="md" hoverable className="docs-prevnext-card">
            <Eyebrow className="docs-prevnext-eyebrow">← Previous</Eyebrow>
            <div className="docs-prevnext-title">
              {prev.title}
            </div>
          </Card>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link href={next.href} className="docs-prevnext-link">
          <Card padding="md" hoverable className="docs-prevnext-card docs-prevnext-card--next">
            <Eyebrow className="docs-prevnext-eyebrow">Next →</Eyebrow>
            <div className="docs-prevnext-title">
              {next.title}
            </div>
          </Card>
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
