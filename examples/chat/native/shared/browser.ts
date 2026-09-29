export interface BrowserConfiguration {
  assistantId: string;
  apiBase: string;
}

// Cached documents retain their owner; final departure releases it.
export function bindBrowserLifetime(
  owner: { dispose(): void },
  target: EventTarget
) {
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    target.removeEventListener('pagehide', onPageHide);
    owner.dispose();
  };
  const onPageHide = (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) dispose();
  };
  target.addEventListener('pagehide', onPageHide);
  return dispose;
}

// Call at the browser composition boundary; importing this module performs no
// I/O and never creates a client, session or conversation.
export function getBrowserConfiguration(
  configuration: BrowserConfiguration,
  origin = window.location.origin
) {
  const assistantId = configuration.assistantId.trim();
  return {
    assistantId,
    apiUrl: new URL('/api', origin).href,
    configured: assistantId.length > 0,
  };
}
