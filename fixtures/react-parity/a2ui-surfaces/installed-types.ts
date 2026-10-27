import {
  createA2uiSurfaces,
  type A2uiSurfaces,
  type A2uiSurfacesSnapshot,
  type A2uiSurfaceSnapshot,
  type A2uiComponentSnapshot,
  type A2uiValue,
} from '@threadplane/content/a2ui';
import { useAgent } from '@threadplane/react';
import { observeAgent } from '@threadplane/angular';
const owner: A2uiSurfaces = createA2uiSurfaces();
export function inference() {
  const react = useAgent(owner),
    angular = observeAgent(owner)();
  const same: typeof react = angular;
  const snapshot: A2uiSurfacesSnapshot = same;
  // @ts-expect-error Published collection is immutable.
  snapshot.surfaces.push({});
  // @ts-expect-error Nested components are immutable.
  snapshot.surfaces[0].components[0].component = 'changed';
  // @ts-expect-error No backend aggregate is invented.
  void same.messages;
  return snapshot;
}
export function contracts(
  surface: A2uiSurfaceSnapshot,
  component: A2uiComponentSnapshot,
  value: A2uiValue
) {
  return { surface, component, value };
}
owner.apply({
  version: 'v0.9',
  createSurface: { surfaceId: 'a', catalogId: 'raw' },
});
// @ts-expect-error Protocol declaration requires a catalog for createSurface.
owner.apply({ version: 'v0.9', createSurface: { surfaceId: 'a' } });
