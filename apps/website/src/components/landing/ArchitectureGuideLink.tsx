'use client';
import Link from 'next/link';
import { trackCtaClick } from '../../lib/analytics/client';

export function ArchitectureGuideLink() {
  const href = '/docs/choosing-an-adapter';
  return (
    <Link
      href={href}
      className="home-text-link"
      onClick={() =>
        trackCtaClick({
          cta_id: 'home_no_runtime_docs',
          track: 'developer',
          surface: 'home',
          destination_url: href,
        })
      }
    >
      Explore the architecture <span aria-hidden="true">›</span>
    </Link>
  );
}
