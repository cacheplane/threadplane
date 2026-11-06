'use client';
import { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getLibraryConfig, type LibraryId } from '../../lib/docs-config';
import { LogoMark } from '../ui/LogoMark';
import { NavDesktop } from './NavDesktop';
import { NavMobile } from './NavMobile';

export function Nav({ githubStars = null }: { githubStars?: number | null }) {
  const starCount = githubStars?.toLocaleString('en-US') ?? null;
  const pathname = usePathname();
  const isDocsPage = pathname.startsWith('/docs');
  const pathParts = pathname.split('/').filter(Boolean);
  const activeLibrary = isDocsPage && pathParts.length >= 2 ? pathParts[1] : '';
  const activeSection = isDocsPage && pathParts.length >= 3 ? pathParts[2] : '';
  const activeSlug = isDocsPage && pathParts.length >= 4 ? pathParts[3] : '';
  // A docs URL without a library segment (e.g. /docs/choosing-an-adapter) is
  // library-neutral. Defaulting to a library here made the drawer claim the
  // reader was inside LangGraph's docs.
  const docsLibrary = (getLibraryConfig(activeLibrary)?.id ??
    null) as LibraryId | null;
  const navRef = useRef<HTMLElement>(null);

  return (
    <nav
      ref={navRef}
      className="fixed top-0 left-0 right-0 z-50 nav-bar"
      data-site-navigation=""
      data-route={isDocsPage ? 'docs' : 'marketing'}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 md:px-8 md:py-5">
        <Link href="/" className="nav-logo-link">
          <LogoMark size="md" />
        </Link>

        {/* Desktop links */}
        <NavDesktop starCount={starCount} />

        <NavMobile
          starCount={starCount}
          isDocsPage={isDocsPage}
          docsLibrary={docsLibrary}
          activeSection={activeSection}
          activeSlug={activeSlug}
          navRef={navRef}
        />
      </div>
    </nav>
  );
}
