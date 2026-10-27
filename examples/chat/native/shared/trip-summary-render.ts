import type { PlainValue } from '@threadplane/core';
import type { TripSummaryCard } from './message-content.js';

interface TripElement {
  readonly type: string;
  readonly props: Readonly<Record<string, PlainValue>>;
  readonly children?: readonly string[];
  readonly visible?: { readonly $state: string };
  readonly repeat?: { readonly statePath: string };
}
function element(value: TripElement): TripElement {
  return Object.freeze({
    ...value,
    props: Object.freeze(value.props),
    ...(value.children ? { children: Object.freeze(value.children) } : {}),
    ...(value.visible ? { visible: Object.freeze(value.visible) } : {}),
    ...(value.repeat ? { repeat: Object.freeze(value.repeat) } : {}),
  });
}

// Application preparation stays outside framework rendering and imports no view.
export function prepareTripSummaryRender(card: TripSummaryCard) {
  const entries: [string, TripElement][] = [
    [
      'root',
      element({
        type: 'Trip',
        props: { title: Object.freeze({ $state: '/title' }) },
        children: ['counts', 'days', 'note'],
      }),
    ],
    [
      'counts',
      element({
        type: 'Counts',
        props: { text: Object.freeze({ $state: '/counts' }) },
      }),
    ],
    [
      'days',
      element({
        type: 'Days',
        props: { empty: Object.freeze({ $state: '/emptyDays' }) },
        children: card.days.map((_, index) => `day-${index}`),
      }),
    ],
    [
      'note',
      element({
        type: 'Note',
        props: { text: Object.freeze({ $state: '/note' }) },
        visible: { $state: '/hasNote' },
      }),
    ],
  ];
  for (const [index, day] of card.days.entries()) {
    entries.push(
      [
        `day-${index}`,
        element({
          type: 'Day',
          props: { label: day.label, empty: day.places.length === 0 },
          children: [`places-${index}`],
        }),
      ],
      [
        `places-${index}`,
        element({
          type: 'Places',
          props: {},
          children: [`place-${index}`],
          repeat: { statePath: `/places/${index}` },
        }),
      ],
      [
        `place-${index}`,
        element({
          type: 'Place',
          props: { text: Object.freeze({ $item: '' }) },
        }),
      ]
    );
  }
  return Object.freeze({
    callId: card.callId,
    spec: Object.freeze({
      root: 'root',
      elements: Object.freeze(Object.fromEntries<TripElement>(entries)),
    }),
    state: Object.freeze({
      title: card.title,
      counts: `${card.dayCount} ${card.dayCount === 1 ? 'day' : 'days'} · ${
        card.stopCount
      } ${card.stopCount === 1 ? 'stop' : 'stops'}`,
      emptyDays: card.days.length === 0,
      hasNote: card.note !== undefined,
      note: card.note ?? '',
      places: Object.freeze(
        card.days.map((day) => Object.freeze([...day.places]))
      ),
    }),
  });
}
export type TripSummaryRender = ReturnType<typeof prepareTripSummaryRender>;
