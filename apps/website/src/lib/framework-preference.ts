import {
  parseDocsNarrativePath,
  docsNarrativeHref,
  type DocsFramework,
} from '@threadplane/cockpit-registry/docs-routes';

export const FRAMEWORK_PREFERENCE_KEY = 'threadplane.docs.framework';
const defaultFramework: DocsFramework = 'angular';
const validPreference = (value: string | null): DocsFramework =>
  value === 'react' ? 'react' : defaultFramework;

/** Route identity always wins. Shared and API routes keep their own identity. */
export function frameworkForPath(
  pathname: string,
  preference: DocsFramework
): DocsFramework {
  const route = parseDocsNarrativePath(pathname);
  return route?.scope === 'framework' ? route.framework : preference;
}

export function preferredDocsHref(framework: DocsFramework): string {
  return docsNarrativeHref({
    scope: 'framework',
    framework,
    slug: ['getting-started', 'quickstart'],
  });
}

/** Small external store: no content catalog, runtime registry, or browser work on import. */
export function createFrameworkPreferenceStore(
  storage: () => Pick<Storage, 'getItem' | 'setItem'> = () =>
    window.localStorage
) {
  let value: DocsFramework = defaultFramework;
  let initialized = false;
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      value = validPreference(storage().getItem(FRAMEWORK_PREFERENCE_KEY));
    } catch {
      /* Keep the current tab's value when storage is unavailable. */
    }
    initialized = true;
  };
  const emit = () => listeners.forEach((listener) => listener());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== FRAMEWORK_PREFERENCE_KEY && event.key !== null) return;
    const next = validPreference(event.newValue);
    memoryOnly = false;
    initialized = true;
    if (next === value) return;
    value = next;
    emit();
  };
  return {
    getServerSnapshot: (): DocsFramework => defaultFramework,
    getSnapshot: (): DocsFramework => {
      if (!initialized) read();
      return value;
    },
    subscribe(listener: () => void): () => void {
      if (listeners.size === 0) {
        if (!memoryOnly) read();
        if (typeof window !== 'undefined')
          window.addEventListener('storage', onStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined')
          window.removeEventListener('storage', onStorage);
      };
    },
    setPreference(next: DocsFramework): void {
      const changed = next !== value;
      value = next;
      initialized = true;
      try {
        storage().setItem(FRAMEWORK_PREFERENCE_KEY, next);
        memoryOnly = false;
      } catch {
        memoryOnly = true;
      }
      if (changed) emit();
    },
  };
}

export const frameworkPreference = createFrameworkPreferenceStore();
