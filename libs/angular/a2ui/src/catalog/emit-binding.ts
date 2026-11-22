import type { RenderHost } from '@threadplane/angular/render';

/** Writes a typed value to the render state store if the prop has a binding path. */
export function emitBinding(
  host: RenderHost,
  bindings: Record<string, string> | undefined,
  prop: string,
  value: unknown,
): void {
  const path = bindings?.[prop];
  if (path) {
    host.set(path, value);
  }
}
