/**
 * Wraps an emit function so it becomes a no-op once `isDestroyed()` returns
 * true. Prevents Angular NG0953 ("emit on a destroyed OutputRef") when a late
 * event (e.g. an ask client-tool resolving during teardown) tries to fire
 * after the owning component has been destroyed.
 */
export function makeGuardedEmit<E>(
  emit: (event: E) => void,
  isDestroyed: () => boolean,
): (event: E) => void {
  return (event: E) => {
    if (isDestroyed()) return;
    emit(event);
  };
}
