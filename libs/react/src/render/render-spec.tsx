import { Fragment, useEffect, useMemo, useRef } from 'react';
import {
  evaluateVisibility,
  getByPath,
  resolveBindings,
  resolveElementProps,
} from '@json-render/core';
import type {
  PropResolutionContext,
  VisibilityCondition,
} from '@json-render/core';
import type { RenderSpecProps, RenderValue } from './types.js';
import { ownRenderValue } from './values.js';
import { ownRenderFunctions } from './functions.js';
import { ReadinessGate } from './readiness.js';
import { runActions, type RenderActionHost } from './actions.js';
import type { RenderReadinessEntry, RenderViewProps } from './types.js';

const EMPTY_STATE = Object.freeze({});
interface ElementProps
  extends Omit<
    RenderSpecProps,
    'spec' | 'state' | 'functions' | 'handlers' | 'onStateChange'
  > {
  readonly host: RenderActionHost;
  readonly spec: NonNullable<RenderSpecProps['spec']>;
  readonly elementKey: string;
  readonly context: PropResolutionContext;
  readonly ancestors: ReadonlySet<string>;
}
function repeatKey(
  item: unknown,
  field: string | undefined,
  index: number
): string {
  const value =
    field !== undefined &&
    item !== null &&
    typeof item === 'object' &&
    Object.hasOwn(item, field)
      ? (item as Record<string, unknown>)[field]
      : undefined;
  return typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
    ? `key:${typeof value}:${value}`
    : `index:${index}`;
}
function Element({
  spec,
  elementKey,
  registry,
  loading,
  fallback,
  context,
  ancestors,
  host,
}: ElementProps) {
  if (ancestors.has(elementKey) || !Object.hasOwn(spec.elements, elementKey))
    return null;
  const element = spec.elements[elementKey];
  if (
    !evaluateVisibility(
      element.visible as VisibilityCondition | undefined,
      context
    )
  )
    return null;
  const entry =
    (Object.hasOwn(registry, element.type)
      ? registry[element.type]
      : undefined) ?? fallback;
  if (!entry) return null;
  const rawProps = ownRenderValue(element.props, true) as Record<
    string,
    unknown
  >;
  const props = ownRenderValue(
    resolveElementProps(rawProps, context)
  ) as Readonly<Record<string, RenderValue>>;
  const bindings = resolveBindings(rawProps, context);
  const childKeys = element.children ?? [];
  if (new Set(childKeys).size !== childKeys.length)
    throw new TypeError(
      `Duplicate child IDs in render element ${JSON.stringify(elementKey)}.`
    );
  const nextAncestors = new Set([...ancestors, elementKey]);
  const childrenFor = (childContext: PropResolutionContext) =>
    childKeys.map((key) => (
      <Element
        key={key}
        spec={spec}
        elementKey={key}
        registry={registry}
        loading={loading}
        fallback={fallback}
        context={childContext}
        ancestors={nextAncestors}
        host={host}
      />
    ));
  let children;
  if (element.repeat) {
    const path = element.repeat.statePath;
    const items = getByPath(context.stateModel, path);
    const identities = new Set<string>();
    children = Array.isArray(items)
      ? items.map((item: unknown, index: number) => {
          const key = repeatKey(item, element.repeat?.key, index);
          if (identities.has(key))
            throw new TypeError(
              `Duplicate repeat identity in render element ${JSON.stringify(
                elementKey
              )}.`
            );
          identities.add(key);
          return (
            <Fragment key={key}>
              {childrenFor({
                ...context,
                repeatItem: item,
                repeatIndex: index,
                repeatBasePath: `${path}/${index}`,
              })}
            </Fragment>
          );
        })
      : null;
  } else {
    children = childrenFor(context);
  }
  const view: RenderViewProps = {
    props,
    bindings: bindings ? Object.freeze({ ...bindings }) : undefined,
    elementKey,
    loading,
    children,
    emit: (event, payload) => {
      const declared = element.on;
      if (declared && Object.hasOwn(declared, event))
        runActions(
          host,
          (declared as Readonly<Record<string, unknown>>)[event],
          context,
          payload
        );
    },
    setValue: (prop, value) => {
      const path =
        bindings && Object.hasOwn(bindings, prop) ? bindings[prop] : undefined;
      if (path !== undefined && host.mounted())
        host.onStateChange?.(path, ownRenderValue(value));
    },
  };
  if (
    Object.hasOwn(entry, 'kind') &&
    (entry as RenderReadinessEntry).kind === 'readiness'
  )
    return (
      <ReadinessGate
        entry={entry as RenderReadinessEntry}
        type={element.type}
        {...view}
      />
    );
  const Component = entry as Exclude<typeof entry, RenderReadinessEntry>;
  return <Component {...view} />;
}

/**
 * Present a caller-prepared tree; application code owns validation and state.
 * The tree is read-only unless `handlers` or `onStateChange` is passed.
 */
export function RenderSpec({
  spec,
  registry,
  state = EMPTY_STATE,
  functions,
  handlers,
  onStateChange,
  loading,
  fallback,
}: RenderSpecProps) {
  // Views call through refs, so a handler or callback the app recreates each
  // render never reruns an effect or leaves a view holding a stale one.
  const latest = useRef({ handlers, onStateChange });
  latest.current = { handlers, onStateChange };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // One stable object for the tree's lifetime; it reads the latest props through the ref.
  const host = useMemo<RenderActionHost>(
    () => ({
      get handlers() {
        return latest.current.handlers;
      },
      get onStateChange() {
        return latest.current.onStateChange;
      },
      mounted: () => mounted.current,
      confirm:
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? (message) => window.confirm(message)
          : undefined,
    }),
    []
  );
  if (!spec) return null;
  // Keep resolver reads on owned plain data, including absent prototype-named paths.
  const stateModel = ownRenderValue(state) as Record<string, unknown>;
  return (
    <Element
      spec={spec}
      elementKey={spec.root}
      registry={registry}
      loading={loading}
      fallback={fallback}
      context={{ stateModel, functions: ownRenderFunctions(functions) }}
      ancestors={new Set()}
      host={host}
    />
  );
}
