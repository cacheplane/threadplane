import type { A2uiCreateSurface, A2uiMessage } from '@threadplane/a2ui';
import { assertArrayIndex, captureValue } from './owned-value.js';
import type {
  A2uiComponentSnapshot, A2uiSurfacesSnapshot, A2uiValue,
} from './types.js';

interface Surface {
  readonly create?: Readonly<A2uiCreateSurface>;
  readonly components: ReadonlyMap<string, A2uiComponentSnapshot>;
  readonly dataModel: A2uiValue;
}

/** Internal state only: mutable containers never escape through a snapshot.
 * Every command returns isolated maps and never changes any prior state. */
export interface SurfaceState {
  readonly staged: ReadonlyMap<string, Surface>;
  readonly live: ReadonlyMap<string, Surface>;
}

export function createSurfaceState(): SurfaceState {
  return { staged: new Map(), live: new Map() };
}

function own(value: unknown, key: string): A2uiValue {
  if (value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) assertArrayIndex(key);
  return Object.getOwnPropertyDescriptor(value, key)?.value as A2uiValue;
}

type MutableContainer = Record<string, A2uiValue> | A2uiValue[];

function copyContainer(value: A2uiValue, record = false): MutableContainer {
  if (value === null || typeof value !== 'object') return {};
  const array = Array.isArray(value) && !record;
  const result = array
    ? new Array(value.length)
    : Object.create(record ? Object.prototype : Object.getPrototypeOf(value));
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    Object.defineProperty(result, key, {
      value: descriptor.value, enumerable: descriptor.enumerable,
      writable: true, configurable: true,
    });
  }
  return result;
}

function write(container: MutableContainer, key: string, value: A2uiValue): void {
  if (Array.isArray(container)) assertArrayIndex(key);
  Object.defineProperty(container, key, { value, enumerable: true, configurable: true, writable: true });
}

function setPath(
  model: A2uiValue, segments: readonly string[], value: A2uiValue,
): A2uiValue {
  if (!segments.length) return value;
  const [key, ...rest] = segments;
  const child = own(model, key);
  const copy = copyContainer(model);
  write(copy, key, setPath(child, rest, value));
  return Object.freeze(copy);
}

function deletePath(model: A2uiValue, segments: readonly string[]): A2uiValue {
  if (!segments.length) return Object.freeze({});
  const [key, ...rest] = segments;
  if (!rest.length) {
    // Legacy's top-level branch spreads even an array root into a record.
    if (Array.isArray(model)) assertArrayIndex(key);
    const copy = typeof model === 'string'
      ? Object.fromEntries(Object.entries(model))
      : copyContainer(model, true);
    delete (copy as Record<string, A2uiValue>)[key];
    return Object.freeze(copy);
  }
  const parentKey = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  let parent: A2uiValue = model;
  for (const segment of parentSegments) parent = own(parent, segment);
  if (parent === null || typeof parent !== 'object') return model;
  const copy = copyContainer(parent);
  if (Array.isArray(copy)) write(copy, parentKey, undefined);
  else delete copy[parentKey];
  return setPath(model, parentSegments, Object.freeze(copy));
}

function updateModel(
  model: A2uiValue, path: string | undefined, value: A2uiValue,
): A2uiValue {
  if (!path || path === '/') return value ?? Object.freeze({});
  const segments = path.split('/').filter(Boolean);
  return value === undefined
    ? deletePath(model, segments)
    : setPath(model, segments, value);
}

/** Accept an already parsed, correctly shaped envelope; this is not a schema
 * validator. Capture the entire envelope before computing any next-state work. */
export function transition(
  state: SurfaceState, input: A2uiMessage,
): { state: SurfaceState; publish: boolean } {
  const message = captureValue(input) as unknown as A2uiMessage;
  if ('deleteSurface' in message) {
    const staged = new Map(state.staged), live = new Map(state.live);
    staged.delete(message.deleteSurface.surfaceId);
    live.delete(message.deleteSurface.surfaceId);
    return { state: { staged, live }, publish: true };
  }
  const command = 'createSurface' in message
    ? message.createSurface
    : 'updateComponents' in message
      ? message.updateComponents
      : message.updateDataModel;
  const id = command.surfaceId;
  const liveSurface = state.live.get(id);
  const prior = liveSurface ?? state.staged.get(id) ?? {
    components: new Map(), dataModel: Object.freeze({}),
  };
  let next: Surface = prior;
  if ('createSurface' in message) {
    const create = message.createSurface;
    const theme = create.theme !== undefined ? create.theme : liveSurface?.create?.theme;
    const sendDataModel = create.sendDataModel !== undefined
      ? create.sendDataModel : liveSurface?.create?.sendDataModel;
    next = {
      ...prior,
      create: liveSurface ? Object.freeze({
        surfaceId: id, catalogId: create.catalogId,
        ...(theme !== undefined ? { theme } : {}),
        ...(sendDataModel !== undefined ? { sendDataModel } : {}),
      }) : create,
    };
  } else if ('updateComponents' in message) {
    const components = new Map(prior.components);
    for (const component of message.updateComponents.components)
      components.set(component.id, component as unknown as A2uiComponentSnapshot);
    next = { ...prior, components };
  } else {
    const { path, value } = message.updateDataModel;
    next = { ...prior, dataModel: updateModel(prior.dataModel, path, value as A2uiValue) };
  }
  const staged = new Map(state.staged), live = new Map(state.live);
  const publish = !!liveSurface || (!!next.create && next.components.has('root'));
  if (publish) {
    live.set(id, next);
    staged.delete(id);
  } else {
    staged.set(id, next);
  }
  return { state: { staged, live }, publish };
}

/** Project ordered maps to recursively immutable public plain data. */
export function surfaceSnapshot(state: SurfaceState): A2uiSurfacesSnapshot {
  const surfaces = Array.from(state.live, ([surfaceId, surface]) => {
    const create = surface.create!;
    return Object.freeze({
      surfaceId, catalogId: create.catalogId,
      ...(create.theme !== undefined ? { theme: create.theme } : {}),
      ...(create.sendDataModel !== undefined ? { sendDataModel: create.sendDataModel } : {}),
      components: Object.freeze(Array.from(surface.components.values())),
      dataModel: surface.dataModel,
    });
  });
  return Object.freeze({ surfaces: Object.freeze(surfaces) });
}
