import { absolute, read, record } from './functions.js';
import type { A2uiComponentSnapshot, A2uiSurfaceSnapshot, A2uiValue } from './types.js';

/** One component stamped from a child template for one item of a data model list. */
export interface TemplateInstance {
  readonly component: A2uiComponentSnapshot;
  /** The item's data model path, for example `/items/0`. */
  readonly basePath: string;
}

/** The template a component stamps its children from, when `children` is `{ path, componentId }`. */
function template(component: A2uiComponentSnapshot) {
  const children = component['children'];
  return record(children) &&
    typeof children['path'] === 'string' &&
    typeof children['componentId'] === 'string'
    ? { path: children['path'], componentId: children['componentId'] }
    : null;
}

/** The ids a component names as fixed children, whatever its kind. */
function fixed(component: A2uiComponentSnapshot): readonly string[] {
  const { child, children, tabs, trigger, content } = component;
  const ids: A2uiValue[] = [child, trigger, content];
  if (Array.isArray(children)) ids.push(...children);
  if (Array.isArray(tabs))
    ids.push(...tabs.map((tab) => (record(tab) ? tab['child'] : undefined)));
  return ids.filter((id): id is string => typeof id === 'string');
}

/**
 * Every component a child template stamps, once per list item, with nested
 * templates followed. `ids` holds the components that exist only as template
 * content, whether or not their list has items: their relative paths mean
 * nothing outside an item.
 */
export function templateInstances(surface: A2uiSurfaceSnapshot): {
  readonly ids: ReadonlySet<string>;
  readonly instances: readonly TemplateInstance[];
} {
  const byId = new Map(surface.components.map((item) => [item.id, item]));
  const ids = new Set<string>();
  const mark = (id: string) => {
    const component = byId.get(id);
    if (component === undefined || ids.has(id)) return;
    ids.add(id);
    for (const child of fixed(component)) mark(child);
    const nested = template(component);
    if (nested !== null) mark(nested.componentId);
  };
  for (const component of surface.components) {
    const stamped = template(component);
    if (stamped !== null) mark(stamped.componentId);
  }
  const instances: TemplateInstance[] = [];
  // A component appears once per item path, so a template that names itself ends with its data.
  const seen = new Set<string>();
  const stamp = (component: A2uiComponentSnapshot, basePath: string) => {
    const stamped = template(component);
    if (stamped === null) return;
    const listPath = absolute(basePath, stamped.path);
    const list = read(surface.dataModel, listPath);
    if (!Array.isArray(list)) return;
    for (let index = 0; index < list.length; index += 1)
      visit(stamped.componentId, `${listPath}/${index}`);
  };
  const visit = (id: string, basePath: string) => {
    const component = byId.get(id);
    const key = `${id}@${basePath}`;
    if (component === undefined || seen.has(key)) return;
    seen.add(key);
    instances.push({ component, basePath });
    for (const child of fixed(component)) visit(child, basePath);
    stamp(component, basePath);
  };
  for (const component of surface.components)
    if (!ids.has(component.id)) stamp(component, '');
  return { ids, instances };
}
