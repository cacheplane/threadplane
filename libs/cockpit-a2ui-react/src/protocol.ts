import {
  A2UI_BASIC_CATALOG_ID,
  createA2uiMessageParser,
} from '@threadplane/a2ui';
import { createA2uiSurfaces } from '@threadplane/content/a2ui';
import type { A2uiSurfacesSnapshot } from '@threadplane/content/a2ui';
import type { RenderSpecData } from '@threadplane/react/render';
import { closedFields, copyData, plainRecord, type Data } from './data.js';

export const AIRPORTS = Object.freeze([
  'LAX',
  'JFK',
  'SFO',
  'ORD',
  'BOS',
  'ATL',
  'DFW',
  'SEA',
  'MIA',
  'DEN',
]);
export const FARES = Object.freeze(['Economy', 'Premium', 'Business', 'First']);
export const BOOKING_FIELDS = Object.freeze([
  'origin',
  'dest',
  'date',
  'passengers',
  'fare_class',
] as const);
export type BookingField = (typeof BOOKING_FIELDS)[number];
export type SurfaceKind = 'booking' | 'results' | 'confirmation';
export type Component = Readonly<Record<string, Data>> & {
  readonly id: string;
  readonly component: string;
};
export interface PreparedSurface {
  readonly identity: object;
  readonly surfaceId: SurfaceKind;
  readonly prose: string;
  readonly rawSnapshot: A2uiSurfacesSnapshot;
  readonly model: Readonly<Record<string, Data>>;
  readonly components: Readonly<Record<string, Component>>;
  readonly spec: RenderSpecData;
  readonly sendDataModel: boolean;
  token(id: string): object | undefined;
  current(id: string, token: object | undefined): boolean;
  retireComponent(id: string): void;
  dispose(): void;
}
function requireThat(value: unknown): asserts value {
  if (!value) throw Error('Unsupported A2UI response');
}
function fields(
  value: unknown,
  allowed: readonly string[]
): asserts value is Record<string, Data> {
  requireThat(closedFields(value, allowed));
}
function id(value: unknown): asserts value is string {
  requireThat(
    typeof value === 'string' && value.length > 0 && value.length <= 128
  );
}
function variant(value: Data, allowed: readonly string[]) {
  requireThat(
    value === undefined ||
      (typeof value === 'string' && allowed.includes(value))
  );
}
function path(value: Data): string {
  fields(value, ['path']);
  requireThat(typeof value.path === 'string');
  return value.path;
}
function read(model: Readonly<Record<string, Data>>, p: string): Data {
  requireThat(
    /^\/[A-Za-z_][A-Za-z_0-9]*$/.test(p) && Object.hasOwn(model, p.slice(1))
  );
  return model[p.slice(1)];
}
function text(value: Data, model: Readonly<Record<string, Data>>) {
  if (typeof value !== 'string')
    requireThat(typeof read(model, path(value)) === 'string');
}
function choice(value: Data, allowed: readonly string[]) {
  requireThat(
    Array.isArray(value) &&
      value.length <= 1 &&
      value.every((v) => typeof v === 'string' && allowed.includes(v))
  );
}
export function assertBookingModel(
  model: unknown
): asserts model is Readonly<Record<string, Data>> {
  fields(model, BOOKING_FIELDS);
  requireThat(Object.keys(model).length === 5);
  choice(model.origin, AIRPORTS);
  choice(model.dest, AIRPORTS);
  choice(model.fare_class, FARES);
  requireThat(
    typeof model.date === 'string' &&
      Number.isSafeInteger(model.passengers) &&
      (model.passengers as number) > 0
  );
}
function contextValue(
  value: Data,
  key: string,
  model: Readonly<Record<string, Data>>
) {
  if (plainRecord(value)) {
    const p = path(value);
    requireThat(p === '/' + key);
    return read(model, p);
  }
  return value;
}
/** Shared protocol action admission; never evaluates functions. */
export function validateAction(
  action: Data,
  kind: SurfaceKind,
  model: Readonly<Record<string, Data>>
) {
  fields(action, ['event']);
  fields(action.event, ['name', 'context']);
  const event = action.event;
  fields(
    event.context,
    event.name === 'bookingSubmit'
      ? ['formId', ...BOOKING_FIELDS]
      : event.name === 'flightSelect'
      ? ['flightId']
      : ['formId']
  );
  const ctx = event.context;
  if (event.name === 'bookingSubmit') {
    requireThat(
      kind === 'booking' &&
        Object.keys(ctx).length === 6 &&
        ctx.formId === 'booking'
    );
    const values: Record<string, Data> = {};
    for (const key of BOOKING_FIELDS)
      values[key] = contextValue(ctx[key], key, model);
    assertBookingModel(values);
  } else if (event.name === 'flightSelect') {
    requireThat(kind === 'results' && Object.keys(ctx).length === 1);
    id(contextValue(ctx.flightId, 'flightId', model));
  } else
    requireThat(
      event.name === 'modifySearch' &&
        kind !== 'booking' &&
        Object.keys(ctx).length === 1 &&
        ctx.formId === 'booking'
    );
}
function validateComponent(
  c: Component,
  kind: SurfaceKind,
  model: Readonly<Record<string, Data>>
) {
  id(c.id);
  requireThat(typeof c.component === 'string');
  const props: Record<string, readonly string[]> = {
    Column: ['children'],
    Row: ['children'],
    List: ['children'],
    Card: ['child'],
    Text: ['text', 'variant'],
    Divider: ['axis'],
    Button: ['child', 'variant', 'action', 'checks'],
    ChoicePicker: ['label', 'options', 'value', 'variant', 'checks'],
    DateTimeInput: ['label', 'value', 'enableDate', 'enableTime', 'checks'],
    TextField: ['label', 'value', 'variant', 'checks'],
  };
  requireThat(Object.hasOwn(props, c.component));
  fields(c, ['id', 'component', 'catalogId', ...props[c.component]]);
  requireThat(
    c.catalogId === undefined || c.catalogId === A2UI_BASIC_CATALOG_ID
  );
  if (c.checks !== undefined)
    requireThat(Array.isArray(c.checks) && !c.checks.length);
  switch (c.component) {
    case 'Column':
    case 'Row':
    case 'List':
      requireThat(Array.isArray(c.children));
      for (const child of c.children) id(child);
      break;
    case 'Card':
      id(c.child);
      break;
    case 'Text':
      text(c.text, model);
      variant(c.variant, ['h1', 'h2', 'h3', 'h4', 'h5', 'body', 'caption']);
      break;
    case 'Divider':
      variant(c.axis, ['horizontal', 'vertical']);
      break;
    case 'Button':
      id(c.child);
      variant(c.variant, ['default', 'primary', 'borderless']);
      validateAction(c.action, kind, model);
      break;
    case 'ChoicePicker': {
      requireThat(kind === 'booking');
      text(c.label, model);
      variant(c.variant, ['mutuallyExclusive']);
      const p = path(c.value);
      requireThat(['/origin', '/dest', '/fare_class'].includes(p));
      const allowed = p === '/fare_class' ? FARES : AIRPORTS;
      choice(read(model, p), allowed);
      requireThat(
        Array.isArray(c.options) && c.options.length === allowed.length
      );
      const seen = new Set();
      for (const o of c.options) {
        fields(o, ['label', 'value']);
        requireThat(
          typeof o.label === 'string' &&
            typeof o.value === 'string' &&
            allowed.includes(o.value) &&
            !seen.has(o.value)
        );
        seen.add(o.value);
      }
      break;
    }
    case 'DateTimeInput':
      requireThat(
        kind === 'booking' &&
          path(c.value) === '/date' &&
          c.enableDate === true &&
          (c.enableTime === undefined || c.enableTime === false)
      );
      text(c.label, model);
      break;
    case 'TextField':
      requireThat(
        kind === 'booking' &&
          path(c.value) === '/passengers' &&
          c.variant === 'number'
      );
      text(c.label, model);
      break;
  }
}
function children(c: Component): readonly string[] {
  return Array.isArray(c.children)
    ? (c.children as readonly string[])
    : typeof c.child === 'string'
    ? [c.child]
    : [];
}
function validateTree(
  all: readonly Component[],
  kind: SurfaceKind,
  model: Readonly<Record<string, Data>>
) {
  requireThat(all.length > 0 && all.length <= 512);
  const map: Record<string, Component> = Object.create(null);
  for (const c of all) {
    fields(c, Object.keys(c));
    validateComponent(c, kind, model);
    requireThat(!Object.hasOwn(map, c.id));
    map[c.id] = c;
  }
  requireThat(Object.hasOwn(map, 'root') && map.root.component === 'Column');
  const visited = new Set<string>();
  function visit(key: string, depth: number) {
    requireThat(depth <= 64 && Object.hasOwn(map, key) && !visited.has(key));
    visited.add(key);
    const c = map[key];
    if (c.component === 'Button')
      requireThat(map[c.child as string]?.component === 'Text');
    for (const child of children(c)) visit(child, depth + 1);
  }
  visit('root', 0);
  requireThat(visited.size === all.length);
  return Object.freeze(map);
}
function project(map: Readonly<Record<string, Component>>): RenderSpecData {
  const elements: Record<string, unknown> = Object.create(null);
  for (const c of Object.values(map)) {
    const props: Record<string, Data> = Object.create(null);
    for (const [key, value] of Object.entries(c)) {
      if (
        [
          'id',
          'component',
          'catalogId',
          'children',
          'child',
          'action',
          'checks',
        ].includes(key)
      )
        continue;
      props[key] =
        plainRecord(value) && typeof value.path === 'string'
          ? { $bindState: value.path }
          : value;
    }
    if (['Row', 'Column', 'List'].includes(c.component))
      props.direction = c.component === 'Row' ? 'horizontal' : 'vertical';
    if (c.component === 'Divider') props.axis = c.axis ?? 'horizontal';
    if (c.component === 'ChoicePicker')
      props.variant = c.variant ?? 'mutuallyExclusive';
    if (c.component === 'Button') props.variant = c.variant ?? 'default';
    if (c.component === 'Text') props.variant = c.variant ?? 'body';
    elements[c.id] = { type: c.component, props, children: children(c) };
  }
  return copyData({ root: 'root', elements }) as unknown as RenderSpecData;
}
/** Complete canonical assistant payload only. Validate before parser and owner. */
export function prepareSurface(
  content: string,
  expected: SurfaceKind
): PreparedSurface {
  requireThat(['booking', 'results', 'confirmation'].includes(expected));
  const delimiter = '---a2ui_JSON---',
    at = content.indexOf(delimiter);
  requireThat(
    at >= 0 &&
      (at === 0 || content[at - 1] === '\n') &&
      content[at + delimiter.length] === '\n' &&
      content.indexOf(delimiter, at + delimiter.length) < 0
  );
  const payload = content.slice(at + delimiter.length + 1);
  requireThat(
    payload.endsWith('\n') &&
      new TextEncoder().encode(payload).length <= 1048576
  );
  const messages = payload
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  requireThat(messages.length === 2 || messages.length === 3);
  const commands = ['createSurface', 'updateComponents', 'updateDataModel'];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    fields(m, ['version', commands[i]]);
    requireThat(m.version === 'v0.9' && Object.keys(m).length === 2);
    const command = m[commands[i]];
    fields(
      command,
      i === 0
        ? ['surfaceId', 'catalogId', 'sendDataModel']
        : i === 1
        ? ['surfaceId', 'components']
        : ['surfaceId', 'path', 'value']
    );
    requireThat(command.surfaceId === expected);
    id(command.surfaceId);
    if (i === 0)
      requireThat(
        command.catalogId === A2UI_BASIC_CATALOG_ID &&
          (command.sendDataModel === undefined ||
            typeof command.sendDataModel === 'boolean')
      );
    if (i === 1) requireThat(Array.isArray(command.components));
    if (i === 2)
      requireThat(
        (command.path === undefined || command.path === '/') &&
          plainRecord(command.value)
      );
  }
  const captured = copyData(messages) as unknown as typeof messages;
  const model =
    messages.length === 3
      ? captured[2].updateDataModel.value
      : Object.freeze({});
  if (expected === 'booking') assertBookingModel(model);
  validateTree(captured[1].updateComponents.components, expected, model);
  const owner = createA2uiSurfaces();
  try {
    const parsed = createA2uiMessageParser().push(payload);
    requireThat(parsed.length === messages.length);
    for (const message of parsed) owner.apply(message);
    const rawSnapshot = owner.getSnapshot();
    requireThat(rawSnapshot.surfaces.length === 1);
    const raw = rawSnapshot.surfaces[0];
    requireThat(raw.surfaceId === expected && plainRecord(raw.dataModel));
    const components = validateTree(
        raw.components as readonly Component[],
        expected,
        raw.dataModel
      ),
      spec = project(components);
    // Conservative aggregate capture includes duplicated retained representations.
    copyData({ captured, rawSnapshot, spec });
    let live = true;
    const tokens = new Map(
      Object.keys(components).map((id) => [id, Object.freeze({})])
    );
    return Object.freeze({
      identity: Object.freeze({}),
      surfaceId: expected,
      prose: content.slice(0, at),
      rawSnapshot,
      model: raw.dataModel,
      components,
      spec,
      sendDataModel: raw.sendDataModel === true,
      token: (id: string) => tokens.get(id),
      current: (id: string, token: object | undefined) =>
        live && token !== undefined && tokens.get(id) === token,
      retireComponent: (id: string) => {
        tokens.delete(id);
      },
      dispose: () => {
        if (live) {
          live = false;
          tokens.clear();
          owner.dispose();
        }
      },
    });
  } catch (error) {
    owner.dispose();
    throw error;
  }
}
