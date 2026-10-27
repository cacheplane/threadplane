import type { A2uiMessage } from '@threadplane/a2ui';
import {
  createA2uiSurfaces,
  type A2uiComponentSnapshot,
  type A2uiSurfaceSnapshot,
  type A2uiSurfaces,
  type A2uiSurfacesSnapshot,
  type A2uiValue,
} from './index.js';

const owner: A2uiSurfaces = createA2uiSurfaces();
const messages: A2uiMessage[] = [
  { version: 'v0.9', createSurface: { surfaceId: 'a', catalogId: 'catalog' } },
  { version: 'v0.9', updateComponents: { surfaceId: 'a', components: [{ id: 'root', component: 'Text', text: { path: '/label' } }] } },
  { version: 'v0.9', updateDataModel: { surfaceId: 'a', path: '/value', value: undefined } },
  { version: 'v0.9', deleteSurface: { surfaceId: 'a' } },
];
messages.forEach(owner.apply);
// @ts-expect-error Unsupported envelope.
owner.apply({ version: 'v0.9', ready: { surfaceId: 'a' } });
// @ts-expect-error Protocol version is required.
owner.apply({ deleteSurface: { surfaceId: 'a' } });

// Matches the existing framework bindings' structural observation contract.
function observe<T>(source: { getSnapshot: () => T; subscribe: (notify: () => void) => () => void }): T {
  const unsubscribe = source.subscribe(() => undefined);
  unsubscribe();
  return source.getSnapshot();
}
const inferred = observe(owner);
const snapshot: A2uiSurfacesSnapshot = inferred;
// @ts-expect-error Structural inference preserves the concrete snapshot type.
const wrong: string = inferred;
void wrong;
// @ts-expect-error Surface list is readonly.
snapshot.surfaces.push({});
// @ts-expect-error Snapshot field is readonly.
snapshot.surfaces = [];
const surface: A2uiSurfaceSnapshot = snapshot.surfaces[0];
// @ts-expect-error Component list is readonly.
surface.components.pop();
// @ts-expect-error Metadata is readonly.
surface.catalogId = 'other';
if (surface.theme) {
  // @ts-expect-error Theme values are readonly.
  surface.theme.primaryColor = 'red';
}
const component: A2uiComponentSnapshot = surface.components[0];
// @ts-expect-error Component values are readonly.
component.text = 'changed';
const value: A2uiValue = { nested: [undefined, { explicit: undefined }] };
export function checkValue(input: A2uiValue = value): void {
  if (input !== null && typeof input === 'object') {
    // @ts-expect-error Nested object and array values are readonly.
    input[0] = null;
  }
  if (Array.isArray(input)) {
    // Array.isArray widens readonly arrays; use the declared readonly type.
    const array: readonly A2uiValue[] = input;
    // @ts-expect-error Nested arrays are readonly.
    array.push(undefined);
  }
}
