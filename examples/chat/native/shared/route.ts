export interface BrowserHistory {
  currentUrl(): string;
  push(url: string): void;
  subscribe(onPopState: () => void): () => void;
}

export function selectedThread(url: string): string | null {
  return new URL(url).searchParams.get('thread') || null;
}

export function threadUrl(url: string, id: string | null): string {
  const next = new URL(url);
  if (id === null) next.searchParams.delete('thread');
  else next.searchParams.set('thread', id);
  return next.href;
}

export function browserHistory(target: Window): BrowserHistory {
  return {
    currentUrl: () => target.location.href,
    push: (url) => target.history.pushState(null, '', url),
    subscribe: (listener) => {
      target.addEventListener('popstate', listener);
      return () => target.removeEventListener('popstate', listener);
    },
  };
}
