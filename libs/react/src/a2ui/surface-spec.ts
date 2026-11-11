import type {
  A2uiComponentSnapshot,
  A2uiSurfaceSnapshot,
  A2uiValue,
} from '@threadplane/content/a2ui';
import type {
  RenderElementData,
  RenderSpecData,
  RenderSpecProps,
} from '../render/index.js';

// Protocol structure (identity, child and action wiring), not renderable props.
const RESERVED = new Set([
  'id',
  'component',
  'catalogId',
  'weight',
  'accessibility',
  'checks',
  'child',
  'children',
  'action',
  'tabs',
  'trigger',
  'content',
]);
const record = (
  value: A2uiValue
): value is { readonly [key: string]: A2uiValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function childIds(component: A2uiComponentSnapshot): readonly string[] {
  const { child, children } = component;
  if (typeof child === 'string') return [child];
  // A template ({ path, componentId }) is not expanded by this static slice.
  return Array.isArray(children)
    ? children.filter((id): id is string => typeof id === 'string')
    : [];
}

/** A render tree and read-only state for one published surface, or null when it has no components. */
export interface A2uiSurfaceSpec {
  readonly spec: RenderSpecData | null;
  readonly state: NonNullable<RenderSpecProps['state']>;
}

/**
 * Projects a surface snapshot onto the render tree. Literal props pass through,
 * `{ path }` props read the surface data model, and function-call props are left
 * out. Only components reachable from the root are kept, each at its first
 * position, so a malformed cycle or shared child cannot recurse.
 */
export function a2uiSurfaceSpec(surface: A2uiSurfaceSnapshot): A2uiSurfaceSpec {
  const state = (
    record(surface.dataModel) ? surface.dataModel : {}
  ) as NonNullable<RenderSpecProps['state']>;
  const byId = new Map(surface.components.map((item) => [item.id, item]));
  const root = byId.has('root') ? 'root' : surface.components[0]?.id;
  if (root === undefined) return { spec: null, state };
  const elements: Record<string, RenderElementData> = Object.create(null);
  const placed = new Set<string>([root]);
  const queue = [root];
  for (let index = 0; index < queue.length; index += 1) {
    const component = byId.get(queue[index]) as A2uiComponentSnapshot;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(component)) {
      if (RESERVED.has(key)) continue;
      if (record(value) && typeof value['path'] === 'string')
        props[key] = { $bindState: value['path'] };
      else if (!(record(value) && typeof value['call'] === 'string'))
        props[key] = value;
    }
    const children = childIds(component).filter((id) => {
      if (!byId.has(id) || placed.has(id)) return false;
      placed.add(id);
      queue.push(id);
      return true;
    });
    elements[component.id] = {
      type: component.component,
      props,
      children,
    } as RenderElementData;
  }
  return { spec: { root, elements }, state };
}
