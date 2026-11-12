import {
  resolveA2uiValue,
  type A2uiComponentSnapshot,
  type A2uiSurfaceSnapshot,
  type A2uiValue,
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

/** Which component an element renders and, inside a child template, for which list item. */
export interface A2uiElementSource {
  readonly id: string;
  /** The list item's data model path; empty outside a template. */
  readonly basePath: string;
}

/** The element key of a component: its id, or its id and item path inside a template. */
export const a2uiElementKey = (id: string, basePath: string): string =>
  basePath === '' ? id : `${id}@${basePath}`;

/** A path written inside a template item, as a path from the root. */
const absolute = (basePath: string, path: string): string =>
  path.startsWith('/')
    ? path
    : basePath !== '' && (path === '' || path === '.')
    ? basePath
    : `${basePath}/${path}`;

/** A component's children: fixed ids in its own item, or its template once per list item. */
function childSources(
  component: A2uiComponentSnapshot,
  surface: A2uiSurfaceSnapshot,
  basePath: string
): readonly A2uiElementSource[] {
  const { child, children, tabs, trigger, content } = component;
  const fixed = (ids: readonly unknown[]) =>
    ids
      .filter((id): id is string => typeof id === 'string')
      .map((id) => ({ id, basePath }));
  if (component.component === 'Modal') return fixed([trigger, content]);
  if (component.component === 'Tabs')
    return fixed(
      Array.isArray(tabs) ? tabs.map((tab) => (record(tab) ? tab['child'] : 0)) : []
    );
  if (typeof child === 'string') return fixed([child]);
  if (Array.isArray(children)) return fixed(children);
  if (
    children === undefined ||
    !record(children) ||
    typeof children['path'] !== 'string' ||
    typeof children['componentId'] !== 'string'
  )
    return [];
  const id = children['componentId'];
  const listPath = absolute(basePath, children['path']);
  const list = resolveA2uiValue(surface, { path: listPath });
  return Array.isArray(list)
    ? list.map((_, index) => ({ id, basePath: `${listPath}/${index}` }))
    : [];
}

/** A title or label as text: a literal, a `{ path }` or a function call, resolved. */
function title(
  value: A2uiValue | undefined,
  surface: A2uiSurfaceSnapshot,
  basePath: string
): string {
  const resolved = resolveA2uiValue(surface, value, basePath);
  return typeof resolved === 'string'
    ? resolved
    : typeof resolved === 'number' || typeof resolved === 'boolean'
    ? String(resolved)
    : '';
}

/** A render tree and read-only state for one published surface, or null when it has no components. */
export interface A2uiSurfaceSpec {
  readonly spec: RenderSpecData | null;
  readonly state: NonNullable<RenderSpecProps['state']>;
  /** The component and list item behind each element key. */
  readonly sources: ReadonlyMap<string, A2uiElementSource>;
}

/**
 * Projects a surface snapshot onto the render tree. Literal props pass through,
 * `{ path }` props read the surface data model, and function-call props are
 * resolved to their current value (left out when they have none). Modal
 * children are its trigger then its content; Tabs children are its tab bodies,
 * with their titles resolved to text; ChoicePicker option labels are resolved
 * the same way. A child template (`children: { path, componentId }`) is
 * stamped once per item of its list, and inside it a path without a leading
 * slash is read from, and bound to, that item. Only components reachable from
 * the root are kept, each at its first position per item, so a malformed
 * cycle or shared child cannot recurse.
 */
export function a2uiSurfaceSpec(surface: A2uiSurfaceSnapshot): A2uiSurfaceSpec {
  const state = (
    record(surface.dataModel) ? surface.dataModel : {}
  ) as NonNullable<RenderSpecProps['state']>;
  const sources = new Map<string, A2uiElementSource>();
  const byId = new Map(surface.components.map((item) => [item.id, item]));
  const root = byId.has('root') ? 'root' : surface.components[0]?.id;
  if (root === undefined) return { spec: null, state, sources };
  const elements: Record<string, RenderElementData> = Object.create(null);
  sources.set(root, { id: root, basePath: '' });
  const queue = [root];
  for (let index = 0; index < queue.length; index += 1) {
    const { id, basePath } = sources.get(queue[index]) as A2uiElementSource;
    const component = byId.get(id) as A2uiComponentSnapshot;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(component)) {
      if (RESERVED.has(key)) continue;
      if (record(value) && typeof value['call'] === 'string') {
        // A computed prop is a plain value: nothing can write back through it.
        const computed = resolveA2uiValue(surface, value, basePath);
        if (computed !== undefined) props[key] = computed;
      } else if (record(value) && typeof value['path'] === 'string')
        props[key] = { $bindState: absolute(basePath, value['path']) };
      else props[key] = value;
    }
    const kept = childSources(component, surface, basePath).flatMap((source) => {
      const key = a2uiElementKey(source.id, source.basePath);
      if (!byId.has(source.id) || sources.has(key)) return [];
      sources.set(key, source);
      queue.push(key);
      return [{ key, id: source.id }];
    });
    if (component.component === 'Tabs') {
      // One title per kept child, so a dropped tab never shifts the others.
      const tabs = Array.isArray(component['tabs']) ? component['tabs'] : [];
      props['tabTitles'] = kept.map((item) =>
        title(
          tabs.find((tab) => record(tab) && tab['child'] === item.id)?.['title' as never],
          surface,
          basePath
        )
      );
    }
    if (component.component === 'ChoicePicker') {
      // Option labels resolved to text, so the view never reads the data model.
      const options = component['options'];
      props['options'] = (Array.isArray(options) ? options : []).flatMap(
        (option) =>
          record(option) && typeof option['value'] === 'string'
            ? [
                {
                  label: title(option['label'], surface, basePath),
                  value: option['value'],
                },
              ]
            : []
      );
    }
    elements[queue[index]] = {
      type: component.component,
      props,
      children: kept.map((item) => item.key),
    } as RenderElementData;
  }
  return { spec: { root, elements }, state, sources };
}
