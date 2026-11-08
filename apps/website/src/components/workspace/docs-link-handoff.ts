/** Keep native link activation on the original article during its first handoff. */
export function hasBusyDocsLink(host: HTMLElement): boolean {
  const focused = host.ownerDocument.activeElement?.closest('a[href]');
  return Boolean(
    (focused && host.contains(focused)) || host.querySelector('a[href]:active')
  );
}

export function deferDocsLinkHandoff(
  host: HTMLElement,
  commit: () => void
): () => void {
  const document = host.ownerDocument;
  const window = document.defaultView;
  if (!window) return () => undefined;
  let cancelled = false;
  let timer: number | undefined;
  const releaseEvents = [
    'pointerup',
    'pointercancel',
    'keyup',
    'focusout',
  ] as const;
  const cancel = () => {
    cancelled = true;
    window.clearTimeout(timer);
    for (const event of releaseEvents)
      document.removeEventListener(event, schedule, true);
    window.removeEventListener('blur', schedule);
  };
  const schedule = () => {
    window.clearTimeout(timer);
    // Native click, focus and navigation defaults must finish before replacement.
    timer = window.setTimeout(() => {
      if (cancelled) return;
      if (!host.isConnected) {
        cancel();
        return;
      }
      if (hasBusyDocsLink(host)) return;
      cancel();
      commit();
    }, 0);
  };
  for (const event of releaseEvents)
    document.addEventListener(event, schedule, true);
  window.addEventListener('blur', schedule);
  return cancel;
}
