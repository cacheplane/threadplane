// Independent provider-proof expectations, never imported by the application.
export const prompt =
  'Recap this supplied trip: City break; day 1 Museum and Park; day 2 Cafe. Note: Walk between stops. Use show_trip_summary once and finish.';
export const nextPrompt =
  'What was the title of the supplied trip? Answer without calling tools.';
export const summaryArgs = {
  title: 'City break',
  days: [
    { day: 1, places: ['Museum', 'Park'] },
    { day: 2, places: ['Cafe'] },
  ],
  note: 'Walk between stops.',
};
export const summaryText =
  'City break\nDay 1: Museum → Park\nDay 2: Cafe\nWalk between stops.';
export const expectedClientTools = [
  {
    name: 'show_trip_summary',
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
  },
];
