'use client';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LibraryId } from '../../lib/docs-config';
import {
  trackCtaClick,
  trackExternalLinkClick,
} from '../../lib/analytics/client';
import type { AnalyticsLibrary } from '../../lib/analytics/events';
import { Button } from '../ui/Button';
import { GitHubIcon } from '../ui/GitHubIcon';
import { GITHUB_REPO_URL } from '../../lib/positioning';
import { DocsContextContent } from '../docs/DocsControlPlane';
import { NavPanelBody } from './NavPanelBody';
import { NAV_TRIGGERS } from './nav-config';

const toAnalyticsLibrary = (library: LibraryId | null): AnalyticsLibrary => {
  switch (library) {
    case 'langgraph':
    case 'render':
    case 'chat':
    case 'ag-ui':
      return library;
    default:
      return 'unknown';
  }
};

/**
 * Where the drawer is in its drill-in stack: the list of triggers, or one
 * trigger's panel. Depth carries what the Site/Docs tab strip used to.
 */
type MobileLevel = { kind: 'root' } | { kind: 'panel'; id: string };

const rootLevel: MobileLevel = { kind: 'root' };
const docsLevel: MobileLevel = { kind: 'panel', id: 'docs' };
/** Stable references, so re-running the open reset cannot churn a render. */
const initialLevel = (isDocsPage: boolean): MobileLevel =>
  isDocsPage ? docsLevel : rootLevel;

/** Structural equality for the two-shape MobileLevel union. */
const sameLevel = (a: MobileLevel, b: MobileLevel): boolean =>
  a.kind === 'panel' && b.kind === 'panel'
    ? a.id === b.id
    : a.kind === b.kind;

const mobilePanel = (id: string) => {
  const trigger = NAV_TRIGGERS.find((entry) => entry.id === id);
  return trigger?.kind === 'panel' ? trigger.panel : undefined;
};

function MenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export interface NavMobileProps {
  readonly starCount?: string | null;
  readonly isDocsPage: boolean;
  readonly docsLibrary: LibraryId | null;
  readonly activeSection: string;
  readonly activeSlug: string;
  /** The <nav> element, so the drawer can make it inert while open. */
  readonly navRef: RefObject<HTMLElement | null>;
}

export function NavMobile({
  starCount = null,
  isDocsPage,
  docsLibrary,
  activeSection,
  activeSlug,
  navRef,
}: NavMobileProps) {
  const [open, setOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const mobileBackRef = useRef<HTMLButtonElement>(null);
  /** The root trigger rows, so a pop can land back on the one it came from. */
  const rootRowRefs = useRef(new Map<string, HTMLButtonElement>());
  /**
   * Which root row a pending pop should focus. Read by the per-level focus
   * effect below: the row does not exist while the panel level is mounted,
   * so the restore has to wait until root has rendered.
   */
  const pendingRootFocusRef = useRef<string | null>(null);
  const restoreMobileFocusRef = useRef(false);
  const pendingMobileSearchRef = useRef(false);
  const cancelScheduledMobileRestoreRef = useRef<(() => void) | null>(null);
  const cancelScheduledMobileRestore = useCallback(() => {
    cancelScheduledMobileRestoreRef.current?.();
    cancelScheduledMobileRestoreRef.current = null;
  }, []);
  const closeMobileMenu = useCallback((openSearch = false) => {
    restoreMobileFocusRef.current = true;
    pendingMobileSearchRef.current = openSearch;
    setOpen(false);
  }, []);

  const [level, setLevel] = useState<MobileLevel>(() =>
    initialLevel(isDocsPage)
  );

  /**
   * Pop back to the root list, remembering the trigger row the reader came
   * from. Pushing lands on the level's "Back to menu" row; popping mirrors it
   * by landing back on that trigger, so the two moves are symmetric.
   */
  const popToRoot = useCallback((fromId: string) => {
    pendingRootFocusRef.current = fromId;
    setLevel(rootLevel);
  }, []);

  useEffect(() => {
    if (open) setLevel(initialLevel(isDocsPage));
  }, [isDocsPage, open]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  useEffect(() => {
    const nav = navRef.current;
    const siteContent = document.getElementById('site-content');
    if (nav) nav.inert = open;
    if (siteContent) siteContent.inert = open;
    return () => {
      if (nav) nav.inert = false;
      if (siteContent) siteContent.inert = false;
    };
  }, [open]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const desktop = window.matchMedia('(min-width: 64rem)');
    const closeAtDesktop = ({ matches }: Pick<MediaQueryList, 'matches'>) => {
      if (!matches) return;
      restoreMobileFocusRef.current = false;
      pendingMobileSearchRef.current = false;
      cancelScheduledMobileRestore();
      setOpen(false);
    };
    const handleChange = (event: MediaQueryListEvent) => closeAtDesktop(event);
    desktop.addEventListener('change', handleChange);
    closeAtDesktop(desktop);
    return () => desktop.removeEventListener('change', handleChange);
  }, [cancelScheduledMobileRestore]);
  useEffect(() => {
    if (open || !restoreMobileFocusRef.current) return undefined;
    const restoreFocusAndSearch = () => {
      cancelScheduledMobileRestoreRef.current = null;
      if (!restoreMobileFocusRef.current) return;
      restoreMobileFocusRef.current = false;
      mobileTriggerRef.current?.focus();
      if (pendingMobileSearchRef.current) {
        pendingMobileSearchRef.current = false;
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', metaKey: true })
        );
      }
    };
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(restoreFocusAndSearch);
      cancelScheduledMobileRestoreRef.current = () =>
        window.cancelAnimationFrame(frame);
    } else {
      const timer = window.setTimeout(restoreFocusAndSearch, 0);
      cancelScheduledMobileRestoreRef.current = () =>
        window.clearTimeout(timer);
    }
    return cancelScheduledMobileRestore;
  }, [cancelScheduledMobileRestore, open]);
  useEffect(() => {
    if (!open) return undefined;
    const dialog = mobileDialogRef.current;
    // Queried live on every keydown, so the trap only ever sees the controls
    // the current level actually renders.
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    // A pop returns to the trigger row it came from — an explicit ref, never
    // `focusable()[0]`: jsdom's multi-clause querySelectorAll groups by clause
    // rather than returning document order, so index 0 there is not the
    // element a browser would hand back.
    const pendingRootFocus = pendingRootFocusRef.current;
    if (pendingRootFocus !== null) {
      pendingRootFocusRef.current = null;
      rootRowRefs.current.get(pendingRootFocus)?.focus();
    } else {
      // A pushed level leads with its back row; land there so the way out is
      // the first thing the keyboard reaches.
      (mobileBackRef.current ?? focusable()[0])?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Root always dismisses; a pushed level pops back to root; the level
        // the drawer opened at dismisses. The `level.kind === 'panel'` guard
        // matters on a docs route reached via Back: that root was never
        // pushed from (the drawer opened pre-pushed to the docs level), so
        // it is not sameLevel as initialLevel(isDocsPage) — without the
        // guard this branch would try to "pop" a root that is already root,
        // a no-op that leaves closeMobileMenu() unreached and Escape dead.
        // The protected test 'closes on Escape and restores focus to the
        // sole trigger' runs on a docs route and depends on this falling
        // through to closeMobileMenu() at the opening level.
        if (level.kind === 'panel' && !sameLevel(level, initialLevel(isDocsPage))) {
          popToRoot(level.id);
          return;
        }
        closeMobileMenu();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeMobileMenu, isDocsPage, level, open, popToRoot]);

  // The docs level hosts the live docs tree, but only on a docs route — there
  // is no docs context anywhere else, so the marketing panel stands in.
  const docsTreeLevel =
    level.kind === 'panel' && level.id === 'docs' && isDocsPage;
  const panel =
    level.kind === 'panel' && !docsTreeLevel ? mobilePanel(level.id) : undefined;

  return (
    <>
      {/* Mobile hamburger */}
      <button
        ref={mobileTriggerRef}
        className="lg:hidden inline-flex items-center justify-center nav-hamburger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-hidden={open || undefined}
        tabIndex={open ? -1 : 0}
        aria-label="Open menu"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {/* Mobile full-screen overlay — rendered outside nav to avoid stacking context issues.
          Portaled to document.body so it stays a sibling of <nav> in the DOM even though
          this component is invoked from inside nav's flex row (where the hamburger lives). */}
      {open &&
        createPortal(
          <div
            ref={mobileDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            className="lg:hidden fixed left-0 right-0 bottom-0 nav-mobile-overlay"
          >
            <div className="nav-mobile-overlay-inner">
              <button
                type="button"
                className="nav-mobile-dialog-close"
                aria-label="Close menu"
                onClick={() => closeMobileMenu()}
              >
                <CloseIcon />
              </button>

              {level.kind === 'panel' ? (
                <button
                  ref={mobileBackRef}
                  type="button"
                  className="nav-mobile-back"
                  onClick={() => popToRoot(level.id)}
                >
                  <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
                  Back to menu
                </button>
              ) : null}

              {level.kind === 'root' ? (
                <div className="nav-mobile-list">
                  {NAV_TRIGGERS.map((trigger) =>
                    trigger.kind === 'link' ? (
                      <Link
                        key={trigger.id}
                        href={trigger.href}
                        onClick={() => {
                          trackCtaClick({
                            surface: 'mobile_nav',
                            destination_url: trigger.href,
                            cta_id: `mobile_nav_${trigger.ctaId}`,
                            cta_text: trigger.label,
                          });
                          closeMobileMenu();
                        }}
                        className="nav-mobile-row"
                      >
                        {trigger.label}
                      </Link>
                    ) : (
                      <button
                        key={trigger.id}
                        type="button"
                        ref={(node) => {
                          if (node) rootRowRefs.current.set(trigger.id, node);
                          else rootRowRefs.current.delete(trigger.id);
                        }}
                        className="nav-mobile-row"
                        onClick={() => setLevel({ kind: 'panel', id: trigger.id })}
                      >
                        {trigger.label}
                        <ChevronRight
                          size={16}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </button>
                    )
                  )}
                  <a
                    href={GITHUB_REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      trackExternalLinkClick(
                        GITHUB_REPO_URL,
                        {
                          surface: 'mobile_nav',
                          cta_id: 'mobile_nav_github',
                          cta_text: 'GitHub',
                        }
                      );
                      closeMobileMenu();
                    }}
                    className="nav-mobile-github-link"
                  >
                    <GitHubIcon /> GitHub
                    {starCount !== null && <span className="nav-github-stars" aria-label={`${starCount} stars`}>{starCount}</span>}
                  </a>
                  <div className="nav-mobile-cta-wrap">
                    <Button
                      variant="primary"
                      size="lg"
                      href="/contact"
                      onClick={() => {
                        trackCtaClick({
                          surface: 'mobile_nav',
                          destination_url: '/contact',
                          cta_id: 'mobile_nav_talk_to_us',
                          cta_text: 'Talk to Us',
                        });
                        closeMobileMenu();
                      }}
                      className="nav-mobile-cta"
                    >
                      Talk to Us
                    </Button>
                  </div>
                </div>
              ) : null}

              {docsTreeLevel ? (
                <div
                  onClickCapture={(event) => {
                    const link = (
                      event.target as HTMLElement
                    ).closest<HTMLAnchorElement>('a[data-docs-navlink]');
                    if (!link) return;
                    trackCtaClick({
                      surface: 'mobile_nav',
                      destination_url: link.getAttribute('href') ?? link.href,
                      cta_id: 'mobile_nav_docs_page',
                      cta_text: link.textContent?.trim() ?? 'Docs page',
                      library: toAnalyticsLibrary(docsLibrary),
                    });
                  }}
                >
                  <DocsContextContent
                    activeLibrary={docsLibrary}
                    activeSection={activeSection || 'getting-started'}
                    activeSlug={activeSlug || 'introduction'}
                    mobile
                    onNavigate={() => closeMobileMenu()}
                    onSearchHandoff={() => closeMobileMenu(true)}
                  />
                </div>
              ) : null}

              {panel ? (
                <div className="nav-mobile-panel">
                  <NavPanelBody
                    panel={panel}
                    surface="mobile_nav"
                    columnClassName="nav-mobile-group"
                    onNavigate={() => closeMobileMenu()}
                  />
                </div>
              ) : null}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
