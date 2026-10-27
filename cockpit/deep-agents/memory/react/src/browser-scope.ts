export const SCOPE_KEY = 'threadplane.deep-agents-memory.scope.v1';
export const validScope = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value
  );
export interface ScopeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface ScopeEvent {
  readonly key: string | null;
  readonly newValue: string | null;
  readonly storageArea: unknown;
}
export interface ScopeEvents {
  addEventListener(
    type: 'storage',
    listener: (event: ScopeEvent) => void
  ): void;
  removeEventListener(
    type: 'storage',
    listener: (event: ScopeEvent) => void
  ): void;
}
export interface ScopeOptions {
  readonly storage: () => ScopeStorage;
  readonly uuid: () => string;
  readonly events?: ScopeEvents;
}
export type ScopeSnapshot = Readonly<
  | { status: 'ready'; scope: string }
  | { status: 'blocked'; scope?: string; warning: string }
>;
export interface BrowserScope {
  getSnapshot(): ScopeSnapshot;
  subscribe(listener: () => void): () => void;
  /** Call immediately before EVERY author action, including creation/queued runs. */
  admit(): Readonly<{ memory_scope: string }> | undefined;
  dispose(): void;
}
/** One immutable identity per app generation. Storage failure permanently blocks
 * future authoring; a previously captured context can still settle under its owner. */
export function createBrowserScope(options: ScopeOptions): BrowserScope {
  let storage: ScopeStorage | undefined,
    scope: string | undefined,
    disposed = false;
  let snapshot: ScopeSnapshot = Object.freeze({
    status: 'blocked',
    warning:
      'Browser memory setup is unavailable. Reload after checking browser storage.',
  });
  const listeners = new Set<() => void>();
  const block = () => {
    if (snapshot.status === 'blocked') return;
    snapshot = Object.freeze({
      status: 'blocked',
      scope,
      warning:
        'Browser memory identity changed or storage is unavailable. Active work keeps its original scope. Reload before sending again.',
    });
    for (const listener of [...listeners]) listener();
  };
  const onStorage = (event: ScopeEvent) => {
    if (
      disposed ||
      (event.storageArea !== null && event.storageArea !== storage) ||
      (event.key !== null && event.key !== SCOPE_KEY)
    )
      return;
    if (event.key === null || event.newValue !== scope) block();
  };
  let listening = false;
  try {
    storage = options.storage();
    let value = storage.getItem(SCOPE_KEY);
    if (value === null) {
      const generated = options.uuid();
      if (!validScope(generated)) throw Error('Invalid generated identity');
      storage.setItem(SCOPE_KEY, generated);
      value = storage.getItem(SCOPE_KEY);
    }
    if (!validScope(value)) throw Error('Invalid stored identity');
    scope = value;
    snapshot = Object.freeze({ status: 'ready', scope });
    if (options.events) {
      options.events.addEventListener('storage', onStorage);
      listening = true;
    }
  } catch {
    block();
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    admit() {
      if (disposed || snapshot.status !== 'ready') return undefined;
      try {
        if (storage?.getItem(SCOPE_KEY) !== scope) block();
      } catch {
        block();
      }
      return snapshot.status === 'ready'
        ? Object.freeze({ memory_scope: scope! })
        : undefined;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (listening) options.events?.removeEventListener('storage', onStorage);
      block();
      listeners.clear();
    },
  });
}
