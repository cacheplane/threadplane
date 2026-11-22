import type { Spec, UIElement } from '@json-render/core';
import type {
  A2uiSurface, A2uiAction, A2uiChildren,
} from '@threadplane/a2ui';
import {
  resolveDynamic, getByPointer, isPathRef, isFunctionCall,
  createA2uiFunctionRegistry,
} from '@threadplane/a2ui';

/** Shared standard-function registry (formatString, formatters, logic). */
// Pure: an app that never renders A2UI keeps none of this.
const A2UI_FUNCTIONS = /* @__PURE__ */ createA2uiFunctionRegistry();

/** Keys that are protocol structure (base fields + child/action wiring),
 * not renderable props. */
const RESERVED_PROP_KEYS = new Set([
  'id', 'component', 'catalogId', 'weight', 'accessibility', 'checks',
  'child', 'children', 'action', 'tabs', 'trigger', 'content',
]);

type RenderedAction = Record<string, { action: string; params: Record<string, unknown> }>;

function resolveAction(
  action: A2uiAction | undefined,
  surface: A2uiSurface,
  sourceComponentId: string,
): RenderedAction | undefined {
  if (!action || typeof action !== 'object') return undefined;
  if (!('event' in action)) {
    // Local client-side function action — routed to the surface component's
    // built-in `a2ui:localAction` handler (openUrl et al.).
    if ('functionCall' in action && action.functionCall
        && typeof action.functionCall.call === 'string') {
      return {
        click: {
          action: 'a2ui:localAction',
          params: {
            call: action.functionCall.call,
            args: action.functionCall.args ?? {},
          },
        },
      } as RenderedAction;
    }
    return undefined;
  }
  const event = action.event;
  if (!event || typeof event.name !== 'string') return undefined;
  const resolvedContext: Record<string, unknown> = {};
  if (event.context && typeof event.context === 'object') {
    for (const [key, value] of Object.entries(event.context)) {
      if (isPathRef(value)) {
        // Live marker: the surface component substitutes the CURRENT value
        // (user edits included) from its state store at dispatch time —
        // build-time resolution would freeze the agent-seeded snapshot.
        resolvedContext[key] = { $bindState: value.path };
      } else {
        resolvedContext[key] = resolveDynamic(value, surface.dataModel, undefined, A2UI_FUNCTIONS);
      }
    }
  }
  return {
    click: {
      action: 'a2ui:event',
      params: {
        surfaceId: surface.surfaceId,
        sourceComponentId,
        name: event.name,
        context: resolvedContext,
      },
    },
  } as RenderedAction;
}

function childrenToList(
  children: A2uiChildren | undefined,
  surface: A2uiSurface,
): { ids: string[]; templateExpand?: { componentId: string; arrPath: string; arr: unknown[] } } | undefined {
  if (!children) return undefined;
  if (Array.isArray(children)) {
    return { ids: children };
  }
  if (typeof children === 'object' && 'componentId' in children && 'path' in children) {
    const arr = getByPointer(surface.dataModel, children.path);
    if (!Array.isArray(arr)) return { ids: [] };
    const ids = arr.map((_, i) => `${children.componentId}__${i}`);
    return { ids, templateExpand: { componentId: children.componentId, arrPath: children.path, arr } };
  }
  return undefined;
}

export function surfaceToSpec(surface: A2uiSurface): Spec | null {
  if (surface.components.size === 0) return null;

  const elements: Record<string, UIElement> = {};

  for (const [id, comp] of surface.components) {
    const type = typeof comp.component === 'string' ? comp.component : 'Text';
    const rawProps = comp as unknown as Record<string, unknown>;

    const resolvedProps: Record<string, unknown> = {};
    const bindings: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawProps)) {
      if (RESERVED_PROP_KEYS.has(key)) continue;
      if (isPathRef(value)) {
        // Leave path refs as json-render two-way binding markers so the
        // render lib resolves them against its state store on every
        // render. Without this, the catalog component receives a static
        // snapshot taken at conversion time and never reflects user
        // input writes back into the store. The `_bindings` map below
        // tells the catalog component which prop names map to which
        // paths so its injectRenderHost().set(path, value) call can
        // write the typed value back to the render state store.
        const path = (value as { path: string }).path;
        bindings[key] = path;
        resolvedProps[key] = { $bindState: path };
      } else if (isFunctionCall(value)) {
        const resolved = resolveDynamic(value, surface.dataModel, undefined, A2UI_FUNCTIONS);
        if (resolved !== undefined) resolvedProps[key] = resolved;
      } else {
        resolvedProps[key] = resolveDynamic(value, surface.dataModel, undefined, A2UI_FUNCTIONS);
      }
    }
    if (Object.keys(bindings).length > 0) {
      resolvedProps['_bindings'] = bindings;
    }

    // Checkable components surface their live validation message through a
    // reserved store path the surface component writes on failed submits.
    if (componentHasChecks(rawProps)) {
      resolvedProps['errorText'] = { $bindState: `/_a2uiChecks/${id}` };
    }

    const action = (rawProps as { action?: A2uiAction }).action;
    const on = resolveAction(action, surface, id);

    // Map children — Card/Button single child, Modal trigger+content, Tabs tabs[].
    let children: string[] | undefined;
    if ((type === 'Card' || type === 'Button') && typeof rawProps['child'] === 'string') {
      children = [rawProps['child'] as string];
    } else if (type === 'Modal') {
      const ids: string[] = [];
      if (typeof rawProps['trigger'] === 'string') ids.push(rawProps['trigger'] as string);
      if (typeof rawProps['content'] === 'string') ids.push(rawProps['content'] as string);
      children = ids;
    } else if (type === 'Tabs') {
      const items = (rawProps as { tabs?: { title?: unknown; child: string }[] }).tabs ?? [];
      children = items.map(t => t.child);
      // Resolve tab titles and pass them as a plain string array for the Tabs component's tab bar.
      resolvedProps['tabTitles'] = items.map(t =>
        t.title !== undefined
          ? String(resolveDynamic(t.title, surface.dataModel, undefined, A2UI_FUNCTIONS))
          : '',
      );
    } else if (type === 'ChoicePicker') {
      // Resolve options[*].label (DynamicString) so the component receives plain strings.
      const opts = (rawProps as { options?: { label?: unknown; value: string }[] }).options ?? [];
      resolvedProps['options'] = opts.map(o => ({
        label: o.label !== undefined
          ? String(resolveDynamic(o.label, surface.dataModel, undefined, A2UI_FUNCTIONS))
          : '',
        value: o.value,
      }));
    } else {
      const childInfo = childrenToList(rawProps['children'] as A2uiChildren | undefined, surface);
      if (childInfo) {
        children = childInfo.ids;
        if (childInfo.templateExpand) {
          const t = childInfo.templateExpand;
          const templateComp = surface.components.get(t.componentId);
          if (templateComp) {
            const tType = typeof templateComp.component === 'string' ? templateComp.component : 'Text';
            const tRaw = templateComp as unknown as Record<string, unknown>;
            for (let i = 0; i < t.arr.length; i++) {
              const scope = { basePath: `${t.arrPath}/${i}`, item: t.arr[i] };
              const itemProps: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(tRaw)) {
                if (RESERVED_PROP_KEYS.has(k)) continue;
                itemProps[k] = resolveDynamic(v, surface.dataModel, scope, A2UI_FUNCTIONS);
              }
              elements[`${t.componentId}__${i}`] = { type: tType, props: itemProps };
            }
          }
        }
      }
    }

    elements[id] = {
      type,
      props: resolvedProps,
      ...(children ? { children } : {}),
      ...(on ? { on } : {}),
    };
  }

  // Use `root` if present in the components map; otherwise prefer first id.
  const root = surface.components.has('root')
    ? 'root'
    : (surface.components.keys().next().value as string);

  // Seed empty check messages so errorText $bindState bindings resolve
  // (render-element defers mounting while any bound prop is undefined).
  const checkSeeds: Record<string, string> = {};
  for (const [id, comp] of surface.components) {
    if (componentHasChecks(comp as unknown as Record<string, unknown>)) checkSeeds[id] = '';
  }
  const state = Object.keys(checkSeeds).length > 0
    ? { ...surface.dataModel, _a2uiChecks: { ...checkSeeds, ...(surface.dataModel['_a2uiChecks'] as Record<string, unknown> ?? {}) } }
    : surface.dataModel;

  return { root, elements, state } as Spec;
}

/** True when the component carries validation rules the renderer enforces:
 * explicit `checks`, or a TextField `validationRegexp` with a bound value. */
export function componentHasChecks(raw: Record<string, unknown>): boolean {
  if (Array.isArray(raw['checks']) && raw['checks'].length > 0) return true;
  return typeof raw['validationRegexp'] === 'string'
    && raw['validationRegexp'].length > 0
    && isPathRef(raw['value']);
}
