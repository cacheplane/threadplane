import Link from 'next/link';
import { Card } from '../ui/Card';
import { Eyebrow } from '../ui/Eyebrow';
import {
  getNarrativeDocuments,
  type DocumentVariant,
} from '../../lib/docs-catalog';

export function DocsPrevNext({ document }: { document: DocumentVariant }) {
  const pages = getNarrativeDocuments(document.scope).filter(
    (page) => page.library === document.library
  );
  const index = pages.findIndex((page) => page.id === document.id);
  const prev = index > 0 ? pages[index - 1] : null;
  const next = index >= 0 ? pages[index + 1] : null;
  if (!prev && !next) return null;

  return (
    <nav aria-label="Previous and next page" className="docs-prevnext">
      {prev ? (
        <Link href={prev.href} className="docs-prevnext-link">
          <Card padding="md" hoverable className="docs-prevnext-card">
            <Eyebrow className="docs-prevnext-eyebrow">← Previous</Eyebrow>
            <div className="docs-prevnext-title">{prev.title}</div>
          </Card>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link href={next.href} className="docs-prevnext-link">
          <Card
            padding="md"
            hoverable
            className="docs-prevnext-card docs-prevnext-card--next"
          >
            <Eyebrow className="docs-prevnext-eyebrow">Next →</Eyebrow>
            <div className="docs-prevnext-title">{next.title}</div>
          </Card>
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
