import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import type {
  AgentSession,
  AgentSnapshot,
  ToolContract,
} from '@threadplane/core';

/** Observe an app-owned session in an injection context. Destroying that
 * context releases only this subscription; the app retains session lifetime. */
export function observeAgent<
  TTools extends { [K in keyof TTools]: ToolContract }
>(session: AgentSession<TTools>): Signal<AgentSnapshot<TTools>> {
  const destroyRef = inject(DestroyRef);
  const snapshot = signal(session.getSnapshot());
  const release = session.subscribe(() => snapshot.set(session.getSnapshot()));
  destroyRef.onDestroy(release);
  return snapshot.asReadonly();
}
