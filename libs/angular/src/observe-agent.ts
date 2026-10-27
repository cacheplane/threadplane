import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/** Observe an app-owned session in an injection context. Destroying that
 * context releases only this subscription; the app retains session lifetime. */
export function observeAgent<TSnapshot>(session: {
  getSnapshot(): TSnapshot;
  subscribe(notify: () => void): () => void;
}): Signal<TSnapshot> {
  const destroyRef = inject(DestroyRef);
  const snapshot = signal(session.getSnapshot());
  const release = session.subscribe(() => snapshot.set(session.getSnapshot()));
  destroyRef.onDestroy(release);
  return snapshot.asReadonly();
}
