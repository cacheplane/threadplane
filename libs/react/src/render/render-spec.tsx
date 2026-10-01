import { Fragment } from 'react';
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

const EMPTY_STATE = Object.freeze({});
interface ElementProps extends Omit<RenderSpecProps, 'spec' | 'state'> {
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
  const Component =
    (Object.hasOwn(registry, element.type)
      ? registry[element.type]
      : undefined) ?? fallback;
  if (!Component) return null;
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
  return (
    <Component
      props={props}
      bindings={bindings ? Object.freeze({ ...bindings }) : undefined}
      elementKey={elementKey}
      loading={loading}
    >
      {children}
    </Component>
  );
}

/** Present a caller-prepared read-only tree; application code owns validation and state. */
export function RenderSpec({
  spec,
  registry,
  state = EMPTY_STATE,
  loading,
  fallback,
}: RenderSpecProps) {
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
      context={{ stateModel }}
      ancestors={new Set()}
    />
  );
}
