'use client';
import { useEffect } from 'react';

/**
 * Re-applies the URL fragment once a streamed article has arrived.
 *
 * Rendered as the last child of the article's development-only Suspense
 * boundary (see `MdxRenderer`), so it mounts only after everything above it
 * is in the document. A hard load of `/docs/…#heading` performs its fragment
 * scroll — natively, or through `WebsiteWorkspaceSurface` — while that
 * heading may still be streaming, and nothing would put the reader back.
 */
export function StreamedFragmentScroll() {
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!fragment) return;
    let id: string;
    try {
      id = decodeURIComponent(fragment);
    } catch {
      // A malformed escape is not an element id either way.
      return;
    }
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);
  return null;
}
