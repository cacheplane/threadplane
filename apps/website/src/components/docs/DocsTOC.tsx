'use client';
import { useEffect, useRef, useState } from 'react';
import type { DocHeading } from '../../lib/extract-headings';

export function DocsTOC({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState('');
  const tocRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (headings.length === 0) return undefined;
    // "Current section" = the last heading above the reading line. Unlike an
    // IntersectionObserver band, this always yields an active item after a
    // jump-scroll or hash navigation, not only when a heading crosses the band.
    const scrollRoot =
      tocRef.current?.closest<HTMLElement>('.docs-workspace-article') ?? null;

    let frame = 0;
    const update = () => {
      frame = 0;
      // The development article can stream after this rail hydrates. Resolve
      // headings when they arrive, then stop observing the article's DOM.
      const els = headings
        .map((h) => document.getElementById(h.id))
        .filter((el): el is HTMLElement => el !== null);
      if (els.length === headings.length) observer.disconnect();
      const line = scrollRoot
        ? scrollRoot.getBoundingClientRect().top + scrollRoot.clientHeight * 0.25
        : window.innerHeight * 0.25;
      let current = '';
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver(onScroll);
    observer.observe(scrollRoot ?? document.body, { childList: true, subtree: true });
    update();
    const scrollTarget = scrollRoot ?? window;
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      scrollTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <aside ref={tocRef} id="docs-on-this-page" tabIndex={-1} className="hidden xl:block w-56 shrink-0 py-8 pl-8 pr-6 docs-toc">
      <p className="mb-3 docs-toc-label">On this page</p>
      <nav className="flex flex-col gap-0.5 docs-toc-nav">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            className="text-sm transition-colors block docs-toc-link"
            data-level={h.level === 3 ? '3' : undefined}
            data-active={activeId === h.id || undefined}>
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}
