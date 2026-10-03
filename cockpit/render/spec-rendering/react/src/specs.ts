import type { PlaybackSample } from './playback';

export const localSamples: readonly PlaybackSample[] = Object.freeze(
  [
    {
      label: 'Heading + Text',
      json: JSON.stringify(
        {
          root: 'root',
          elements: {
            root: {
              type: 'Heading',
              props: { content: 'Welcome to React Spec Rendering' },
              children: ['description'],
            },
            description: {
              type: 'Text',
              props: {
                content:
                  'This local JSON sample maps each element to a registered React view.',
              },
            },
          },
        },
        null,
        2
      ),
    },
    {
      label: 'Card + Badge',
      json: JSON.stringify(
        {
          root: 'root',
          elements: {
            root: {
              type: 'Card',
              props: { title: 'Streaming Demo' },
              children: ['badge', 'description'],
            },
            badge: { type: 'Badge', props: { label: 'Live Preview' } },
            description: {
              type: 'Text',
              props: {
                content:
                  'A card receives its badge and text as children from RenderSpec.',
              },
            },
          },
        },
        null,
        2
      ),
    },
    {
      label: 'Nested Layout',
      json: JSON.stringify(
        {
          root: 'root',
          elements: {
            root: {
              type: 'Heading',
              props: { content: 'Multi-Level Nesting' },
              children: ['first', 'second'],
            },
            first: {
              type: 'Card',
              props: { title: 'Section One' },
              children: ['firstText'],
            },
            firstText: {
              type: 'Text',
              props: { content: 'The first card contains its own text view.' },
            },
            second: {
              type: 'Card',
              props: { title: 'Section Two' },
              children: ['secondText'],
            },
            secondText: {
              type: 'Text',
              props: {
                content: 'The second card follows in the authored child order.',
              },
            },
          },
        },
        null,
        2
      ),
    },
  ].map((sample) => Object.freeze(sample))
);
