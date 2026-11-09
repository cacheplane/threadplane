'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface DisclosureState {
  readonly summary: string | null;
  readonly open: boolean;
}

export interface DocsDisclosureSnapshot {
  readonly pending: Map<number, DisclosureState>;
}

/** Both trees render the same docsSlot, so document order identifies disclosures. */
export function captureDocsDisclosures(
  host: HTMLElement
): DocsDisclosureSnapshot | null {
  const disclosures = Array.from(host.querySelectorAll('details'));
  if (!disclosures.length) return null;
  return {
    pending: new Map(
      disclosures.map((element, index) => [
        index,
        {
          summary: element.querySelector('summary')?.textContent ?? null,
          open: element.open,
        },
      ])
    ),
  };
}

/** Consume each native state once; later user toggles must remain authoritative. */
export function DocsDisclosureHandoff({
  snapshot,
  children,
}: {
  readonly snapshot: DocsDisclosureSnapshot;
  readonly children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !snapshot.pending.size) return undefined;
    let observer: MutationObserver | undefined;
    const restore = () => {
      const disclosures = host.querySelectorAll('details');
      for (const [index, state] of snapshot.pending) {
        const element = disclosures[index];
        // Do not apply an old choice to different content at the same position.
        if (
          !element ||
          (element.querySelector('summary')?.textContent ?? null) !==
            state.summary
        )
          continue;
        element.open = state.open;
        snapshot.pending.delete(index);
      }
      if (!snapshot.pending.size) observer?.disconnect();
    };
    restore();
    if (snapshot.pending.size) {
      // Streamed MDX can reveal its article after the workspace itself mounts.
      observer = new MutationObserver(restore);
      observer.observe(host, { childList: true, subtree: true });
    }
    return () => observer?.disconnect();
  }, [snapshot]);

  return (
    <div ref={hostRef} className="docs-disclosure-handoff">
      {children}
    </div>
  );
}
