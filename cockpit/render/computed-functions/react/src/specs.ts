import type { PlaybackSample } from './playback';

export const localSamples: readonly PlaybackSample[] = [
  {
    label: 'Text Transforms',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Text Transforms' },
            children: ['upper', 'reversed'],
          },
          upper: {
            type: 'Value',
            props: {
              label: 'Uppercase',
              value: { $computed: 'uppercase', args: { value: 'hello world' } },
            },
          },
          reversed: {
            type: 'Value',
            props: {
              label: 'Reversed',
              value: { $computed: 'reverse', args: { value: 'streaming' } },
            },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Data Display',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Card',
            props: { title: 'Formatted Data' },
            children: ['date', 'product'],
          },
          date: {
            type: 'Value',
            props: {
              label: 'Formatted Date',
              value: {
                $computed: 'formatDate',
                args: { value: '2024-06-15T12:00:00Z' },
              },
            },
          },
          product: {
            type: 'Value',
            props: {
              label: 'Multiply 7 x 6',
              value: { $computed: 'multiply', args: { a: 7, b: 6 } },
            },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Mixed Functions',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Mixed Functions' },
            children: ['calc', 'transform', 'format'],
          },
          calc: {
            type: 'Value',
            props: {
              label: 'Multiply 12 x 5',
              value: { $computed: 'multiply', args: { a: 12, b: 5 } },
            },
          },
          transform: {
            type: 'Value',
            props: {
              label: 'Uppercase',
              value: {
                $computed: 'uppercase',
                args: { value: 'computed functions' },
              },
            },
          },
          format: {
            type: 'Value',
            props: {
              label: 'Date',
              value: {
                $computed: 'formatDate',
                args: { value: '2025-01-01T00:00:00Z' },
              },
            },
          },
        },
      },
      null,
      2
    ),
  },
];
