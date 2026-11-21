import type { Spec, UIElement } from '@json-render/core';

/**
 * The json-render schema prompt shipped with the example backends documents
 * state-bound props as `{ statePath: "/path" }` (the A2UI binding dialect —
 * see `examples/<example>/python/src/schemas/json_render.py`). The
 * @json-render/core
 * prop resolver only understands `$state`/`$bindState` expressions, so a raw
 * `{ statePath }` object would fall through to the view component unresolved
 * and interpolate as the literal string "[object Object]".
 *
 * `normalizeJsonRenderSpec` rewrites each top-level `{ statePath: p }` prop
 * to the engine-native `{ $bindState: p }` AND records it in the element's
 * `_bindings` map (prop name → path) so the a2ui catalog components can
 * write user input back to the state store — mirroring exactly what
 * `surfaceToSpec` does for A2UI path refs.
 */
interface StatePathRef {
  statePath: string;
}

function isStatePathRef(value: unknown): value is StatePathRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)['statePath'] === 'string' &&
    Object.keys(value).length === 1
  );
}

/** Rewrites schema-documented `{ statePath }` prop refs to `$bindState` +
 * `_bindings`. Returns the input reference unchanged when no rewriting is
 * needed (keeps downstream memoization intact). */
export function normalizeJsonRenderSpec(spec: Spec): Spec {
  const sourceElements = (spec.elements ?? {}) as Record<string, UIElement>;
  let specChanged = false;
  const elements: Record<string, UIElement> = {};

  for (const [id, el] of Object.entries(sourceElements)) {
    const rawProps = el?.props as Record<string, unknown> | undefined;
    if (!rawProps) {
      elements[id] = el;
      continue;
    }

    let elementChanged = false;
    const props: Record<string, unknown> = {};
    const bindings: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawProps)) {
      if (isStatePathRef(value)) {
        props[key] = { $bindState: value.statePath };
        bindings[key] = value.statePath;
        elementChanged = true;
      } else {
        props[key] = value;
      }
    }

    if (elementChanged) {
      // Merge with any model-emitted `_bindings` (never observed, but cheap
      // to preserve) — rewritten paths win.
      const existing = (rawProps['_bindings'] ?? {}) as Record<string, string>;
      props['_bindings'] = { ...existing, ...bindings };
      elements[id] = { ...el, props } as UIElement;
      specChanged = true;
    } else {
      elements[id] = el;
    }
  }

  return specChanged ? ({ ...spec, elements } as Spec) : spec;
}
