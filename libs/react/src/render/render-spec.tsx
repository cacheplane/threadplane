import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
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
import { RenderDevtoolsMark, RenderDevtoolsScope } from './devtools.js';
import type {
  RenderReadinessEntry,
  RenderStore,
  RenderViewProps,
} from './types.js';
import {
  checkRenderHandlers,
  dispatchElementEvent,
  type Interaction,
} from './interaction.js';

const EMPTY_STATE = Object.freeze({});
const NO_STORE = Object.freeze({});
const noSubscription = () => () => undefined;
declare const process: { readonly env: { readonly NODE_ENV?: string } };
interface ElementProps
  extends Pick<RenderSpecProps, 'registry' | 'loading' | 'fallback'> {
  readonly spec: NonNullable<RenderSpecProps['spec']>;
  readonly elementKey: string;
  readonly context: PropResolutionContext;
  readonly ancestors: ReadonlySet<string>;
  readonly interaction: Interaction;
  readonly writable: boolean;
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
  interaction,
  writable,
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
        interaction={interaction}
        writable={writable}
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
  const on = element.on;
  const view: RenderViewProps = {
    props,
    bindings: bindings ? Object.freeze({ ...bindings }) : undefined,
    elementKey,
    loading,
    children,
    emit: (event, payload) =>
      dispatchElementEvent(interaction, on, event, context, payload),
    set: writable
      ? (path, value) => {
          if (interaction.alive())
            interaction.store()?.set(path, ownRenderValue(value));
        }
      : undefined,
    result: (value) => {
      if (interaction.alive())
        interaction.report({
          type: 'result',
          value: ownRenderValue(value),
          elementKey,
        });
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
  // Development only: the DevTools render report (see ./devtools.tsx).
  if (process.env.NODE_ENV !== 'production')
    return (
      <>
        <RenderDevtoolsMark elementKey={elementKey} state="mounted" />
        <Component {...view} />
      </>
    );
  return <Component {...view} />;
}

/**
 * Present a caller-prepared tree. Application code owns validation, state and actions: the spec
 * names actions in its `on` bindings, and only `handlers` the application supplies run. With a
 * `store`, views can write state; with `state`, the tree is read-only.
 */
export function RenderSpec({
  spec,
  registry,
  state,
  store,
  functions,
  loading,
  fallback,
  handlers,
  onEvent,
}: RenderSpecProps) {
  if (state !== undefined && store !== undefined)
    throw new TypeError('RenderSpec takes state or a store, not both.');
  checkRenderHandlers(handlers);
  // Actions read the handlers, store and listener of the latest render.
  const latest = useRef({ handlers, store, onEvent });
  latest.current = { handlers, store, onEvent };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const interaction = useMemo<Interaction>(
    () => ({
      handler: (action) => {
        const map = latest.current.handlers;
        return map && Object.hasOwn(map, action) ? map[action] : undefined;
      },
      store: () => latest.current.store,
      report: (event) => latest.current.onEvent?.(event),
      alive: () => mounted.current,
    }),
    []
  );
  const subscribe = useCallback(
    (notify: () => void) =>
      store ? store.subscribe(notify) : noSubscription(),
    [store]
  );
  const read = useCallback(
    () => (store ? store.getSnapshot() : NO_STORE),
    [store]
  );
  const snapshot = useSyncExternalStore(subscribe, read, read);
  useStateChangeEvents(store, interaction);
  if (!spec) return null;
  // Keep resolver reads on owned plain data, including absent prototype-named paths.
  const stateModel = ownRenderValue(
    store ? snapshot : state ?? EMPTY_STATE
  ) as Record<string, unknown>;
  const tree = (
    <Element
      spec={spec}
      elementKey={spec.root}
      registry={registry}
      loading={loading}
      fallback={fallback}
      context={{ stateModel, functions: ownRenderFunctions(functions) }}
      ancestors={new Set()}
      interaction={interaction}
      writable={store !== undefined}
    />
  );
  // Development only: the DevTools render report (see ./devtools.tsx).
  if (process.env.NODE_ENV !== 'production')
    return (
      <RenderDevtoolsScope spec={spec} registry={registry}>
        {tree}
      </RenderDevtoolsScope>
    );
  return tree;
}

/** Reports each store write as a `stateChange` event while the tree is mounted. */
function useStateChangeEvents(
  store: RenderStore | undefined,
  interaction: Interaction
) {
  useEffect(() => {
    if (!store) return;
    return store.subscribe(() => {
      if (!interaction.alive()) return;
      const snapshot = store.getSnapshot();
      const change = store.lastChange?.();
      interaction.report({
        type: 'stateChange',
        path: change?.path ?? '/',
        value: change ? change.value : snapshot,
        snapshot,
      });
    });
  }, [store, interaction]);
}
