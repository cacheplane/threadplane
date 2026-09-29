import type { DeepReadonly, ToolCall } from '@threadplane/core';
import type { FunctionTool, ToolContracts } from '@threadplane/core/tools';

export interface TripSummaryArgs {
  title: string;
  days: { day: number; places: string[] }[];
  note?: string;
}

// Formatting is ordinary authored code, not interpretation of schema metadata.
// A malformed argument throws here and is owned by the runtime's tool error path.
export function formatTripSummary(args: DeepReadonly<TripSummaryArgs>) {
  const title = args.title.trim();
  const days = Object.freeze(
    args.days.map((day) =>
      Object.freeze({
        label: `Day ${day.day.toPrecision()}`,
        places: Object.freeze(day.places.map((place) => place.trim())),
      })
    )
  );
  const note = args.note === undefined ? undefined : args.note.trim();
  const text = [
    title,
    ...days.map(
      (day) => `${day.label}: ${day.places.join(' → ') || 'No stops'}`
    ),
    ...(note === undefined ? [] : [note]),
  ].join('\n');
  return Object.freeze({
    title,
    days,
    note,
    dayCount: days.length,
    stopCount: days.reduce((count, day) => count + day.places.length, 0),
    text,
  });
}

const showTripSummary: FunctionTool<TripSummaryArgs, string> = {
  description:
    'Show a supplied trip recap with days and places. This terminal summary needs no follow-up; it does not plan or change an itinerary.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', minimum: 1 },
            places: { type: 'array', items: { type: 'string' } },
          },
          required: ['day', 'places'],
        },
      },
      note: { type: 'string' },
    },
    required: ['title', 'days'],
  },
  followUp: false,
  handler: (args) => formatTripSummary(args).text,
};

export const applicationTools = { show_trip_summary: showTripSummary };
export type ApplicationToolContracts = ToolContracts<typeof applicationTools>;
export type ApplicationToolCall = ToolCall<ApplicationToolContracts>;
