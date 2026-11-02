import { effect, inject, untracked, type WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, NavigationEnd, type NavigationExtras } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';

/** Configures synchronization between the active thread signal and Angular router URLs. */
export interface ThreadRoutingConfig {
  /** The app-owned source-of-truth signal for the active thread id. */
  threadId: WritableSignal<string | null>;
  /** Router commands for a thread id (or the bare/welcome path when null).
   *  Default: `(id) => (id ? ['/', id] : ['/'])`. */
  toCommands?: (id: string | null) => unknown[];
  /** Extract the thread id from a URL (null = bare). Default: last non-empty path segment. */
  threadIdFromUrl?: (url: string) => string | null;
  /** Optional async validity check; on `false` the helper redirects to the bare path
   *  (`replaceUrl: true`). LangGraph apps pass `id => threads.getThread(id).then(Boolean)`. */
  validate?: (id: string) => Promise<boolean>;
  /** Extras merged into every navigate (default `{ queryParamsHandling: 'preserve' }`). */
  navigationExtras?: NavigationExtras;
}

const defaultFromUrl = (url: string): string | null => {
  const seg = url.split('?')[0].split('#')[0].split('/').filter(Boolean);
  return seg.length ? seg[seg.length - 1] : null;
};
const defaultToCommands = (id: string | null): unknown[] => (id ? ['/', id] : ['/']);

/**
 * Bind an app-owned `activeThreadId` signal to the URL — restore on load, stamp on change,
 * validate-or-redirect, with a bare URL meaning "no thread" (welcome). URL is the source of
 * truth; nothing is written to localStorage. Must be called in an injection context.
 *
 * @example
 * ```ts
 * export const ACTIVE_THREAD = signal<string | null>(null);
 * // providers: provideAgent({ threadId: ACTIVE_THREAD, onThreadId: id => ACTIVE_THREAD.set(id) })
 * const threads = inject(LangGraphThreadsAdapter);
 * injectThreadRouting({ threadId: ACTIVE_THREAD, validate: id => threads.getThread(id).then(Boolean) });
 * ```
 */
export function injectThreadRouting(config: ThreadRoutingConfig): void {
  const router = inject(Router);
  const fromUrl = config.threadIdFromUrl ?? defaultFromUrl;
  const toCommands = config.toCommands ?? defaultToCommands;
  const extras: NavigationExtras = config.navigationExtras ?? { queryParamsHandling: 'preserve' };

  const urlThreadId = toSignal(
    router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => fromUrl(e.urlAfterRedirects)),
      startWith(fromUrl(router.url)),
    ),
    { initialValue: fromUrl(router.url) },
  );

  // Seed the signal from the URL once.
  config.threadId.set(urlThreadId());

  // URL → signal.
  effect(() => {
    const urlId = urlThreadId();
    if (urlId !== untracked(() => config.threadId())) config.threadId.set(urlId);
  });

  // signal → URL.
  effect(() => {
    const id = config.threadId();
    const urlId = untracked(() => urlThreadId());
    if (id !== urlId) void router.navigate(toCommands(id), extras);
  });

  // validate stale ids → redirect to bare. Memoize the last id checked so
  // re-visiting the same thread (A → B → A) doesn't re-hit the backend.
  if (config.validate) {
    const validate = config.validate;
    let lastValidated: string | null = null;
    effect(() => {
      const id = urlThreadId();
      if (!id || id === lastValidated) return;
      lastValidated = id;
      void validate(id).then((ok) => {
        if (!ok && untracked(() => urlThreadId()) === id) {
          void router.navigate(toCommands(null), { ...extras, replaceUrl: true });
        }
      });
    });
  }
}
