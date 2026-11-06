'use client';
import { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getLibraryConfig, type LibraryId } from '../../lib/docs-config';
import { parseDocsNarrativePath } from '@threadplane/cockpit-registry/docs-routes';
import { LogoMark } from '../ui/LogoMark';
import { NavDesktop } from './NavDesktop';
import { NavMobile } from './NavMobile';

export function Nav() {
  const pathname = usePathname();
  const isDocsPage = pathname.startsWith('/docs');
  const narrative = parseDocsNarrativePath(pathname);
  const parts = narrative?.slug ?? [];
  const activeLibrary = parts.length === 3 ? parts[0] : '';
  const activeSection = parts.length === 3 ? parts[1] : '';
  const activeSlug = parts.length === 3 ? parts[2] : '';
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
        <NavDesktop />

        <NavMobile
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
