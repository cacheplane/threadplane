import type {
  A2uiComponentSnapshot,
  A2uiSurfaceSnapshot,
} from '@threadplane/content/a2ui';
import type { TripSummaryCard } from '../../shared/message-content.js';

export const TRIP_CATALOG_ID = 'urn:threadplane:native:trip-summary:v1';
export interface TripSurface {
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly components: readonly A2uiComponentSnapshot[];
}
export interface A2uiTripSummaryRender {
  readonly callId: string;
  readonly spec: {
    readonly root: string;
    readonly elements: Readonly<
      Record<
        string,
        {
          readonly type: string;
          readonly props: Readonly<Record<string, string | boolean>>;
          readonly children?: readonly string[];
        }
      >
    >;
  };
  readonly state: Readonly<Record<string, never>>;
}
const fields = {
  Trip: { title: 'string', children: 'children' },
  Counts: { text: 'string' },
  Days: { empty: 'boolean', children: 'children' },
  Day: { label: 'string', empty: 'boolean', children: 'children' },
  Places: { children: 'children' },
  Place: { text: 'string' },
  Note: { text: 'string' },
} as const;
type TripType = keyof typeof fields;
const childTypes: Readonly<Record<TripType, readonly TripType[]>> = {
  Trip: ['Counts', 'Days', 'Note'],
  Days: ['Day'],
  Day: ['Places'],
  Places: ['Place'],
  Counts: [],
  Place: [],
  Note: [],
};

// Only application-authored literal descriptions enter this private catalog.
export function buildTripSurface(card: TripSummaryCard): TripSurface {
  const components: A2uiComponentSnapshot[] = [
    {
      id: 'root',
      component: 'Trip',
      title: card.title,
      children: [
        'counts',
        'days',
        ...(card.note === undefined ? [] : ['note']),
      ],
    },
    {
      id: 'counts',
      component: 'Counts',
      text: `${card.dayCount} ${card.dayCount === 1 ? 'day' : 'days'} · ${
        card.stopCount
      } ${card.stopCount === 1 ? 'stop' : 'stops'}`,
    },
    {
      id: 'days',
      component: 'Days',
      empty: card.days.length === 0,
      children: card.days.map((_, index) => `day-${index}`),
    },
  ];
  card.days.forEach((day, index) => {
    components.push(
      {
        id: `day-${index}`,
        component: 'Day',
        label: day.label,
        empty: day.places.length === 0,
        children: [`places-${index}`],
      },
      {
        id: `places-${index}`,
        component: 'Places',
        children: day.places.map((_, place) => `place-${index}-${place}`),
      },
      ...day.places.map((text, place) => ({
        id: `place-${index}-${place}`,
        component: 'Place',
        text,
      }))
    );
  });
  if (card.note !== undefined)
    components.push({ id: 'note', component: 'Note', text: card.note });
  const surface = {
    surfaceId: card.callId,
    catalogId: TRIP_CATALOG_ID,
    components,
  };
  validateTripSurface(surface);
  components.forEach((component) => {
    if (Array.isArray(component['children']))
      Object.freeze(component['children']);
    Object.freeze(component);
  });
  return Object.freeze({ ...surface, components: Object.freeze(components) });
}
export function validateTripSurface(surface: TripSurface): void {
  if (
    surface.catalogId !== TRIP_CATALOG_ID ||
    typeof surface.surfaceId !== 'string' ||
    !Array.isArray(surface.components)
  )
    throw new TypeError('Invalid authored trip surface');
  if (
    Object.keys(surface).some(
      (key) =>
        !['surfaceId', 'catalogId', 'components', 'dataModel'].includes(key)
    )
  )
    throw new TypeError('Unknown authored trip surface field');
  const components = new Map<string, A2uiComponentSnapshot>();
  for (const component of surface.components) {
    if (
      !component ||
      typeof component !== 'object' ||
      typeof component.id !== 'string' ||
      !component.id ||
      components.has(component.id) ||
      !Object.hasOwn(fields, component.component)
    )
      throw new TypeError('Invalid authored trip component');
    const schema = fields[component.component as TripType];
    if (
      Object.keys(component).some(
        (key) =>
          key !== 'id' && key !== 'component' && !Object.hasOwn(schema, key)
      )
    )
      throw new TypeError('Unknown authored trip field');
    for (const [key, type] of Object.entries(schema)) {
      const value = component[key];
      if (
        !Object.hasOwn(component, key) ||
        (type === 'children'
          ? !Array.isArray(value) || value.some((id) => typeof id !== 'string')
          : typeof value !== type)
      )
        throw new TypeError('Invalid literal authored trip field');
    }
    components.set(component.id, component);
  }
  if (components.get('root')?.component !== 'Trip')
    throw new TypeError('Trip root required');
  const visited = new Set<string>();
  function visit(id: string): void {
    const component = components.get(id);
    if (!component || visited.has(id))
      throw new TypeError('Invalid authored trip tree');
    visited.add(id);
    for (const childId of (component['children'] ?? []) as readonly string[]) {
      const child = components.get(childId);
      if (
        !child ||
        !childTypes[component.component as TripType].includes(
          child.component as TripType
        )
      )
        throw new TypeError('Invalid authored trip child');
      visit(childId);
    }
  }
  visit('root');
  if (visited.size !== components.size)
    throw new TypeError('Unreachable authored trip component');
}
export function projectTripSurface(
  surface: A2uiSurfaceSnapshot,
  callId: string
): A2uiTripSummaryRender {
  validateTripSurface(surface);
  const elements = Object.fromEntries(
    surface.components.map((component) => {
      const props: Record<string, string | boolean> = {};
      for (const key of Object.keys(fields[component.component as TripType])) {
        if (key !== 'children') props[key] = component[key] as string | boolean;
      }
      return [
        component.id,
        Object.freeze({
          type: component.component,
          props: Object.freeze(props),
          ...(component['children'] === undefined
            ? {}
            : {
                children: Object.freeze([
                  ...(component['children'] as readonly string[]),
                ]),
              }),
        }),
      ];
    })
  );
  return Object.freeze({
    callId,
    spec: Object.freeze({ root: 'root', elements: Object.freeze(elements) }),
    state: Object.freeze({}),
  });
}
