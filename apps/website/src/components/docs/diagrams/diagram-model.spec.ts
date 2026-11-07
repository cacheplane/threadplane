import { expect, test } from 'vitest';
import {
  nodeMetrics,
  sequenceLayout,
  validateDiagram,
  wrapLabel,
  type NetworkDefinition,
} from './diagram-model';

const graph: NetworkDefinition = {
  kind: 'architecture',
  title: 'Ownership',
  caption: 'Requests and events.',
  description: 'The browser sends a request to the server.',
  width: 640,
  height: 300,
  nodes: [
    { id: 'client', x: 20, y: 20, width: 200, title: 'Client' },
    { id: 'server', x: 400, y: 20, width: 200, title: 'Server' },
  ],
  edges: [
    {
      from: 'client',
      to: 'server',
      points: [
        [220, 58],
        [400, 58],
      ],
      label: { text: 'request', x: 310, y: 44 },
    },
  ],
};

test('wraps prose and long API names without dropping characters', () => {
  expect(wrapLabel('one two three', 7)).toEqual(['one two', 'three']);
  expect(wrapLabel('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
  expect(() => wrapLabel('text', 0)).toThrow();
});

test('node height grows with wrapped title and detail', () => {
  const short = nodeMetrics({ ...graph.nodes[0], title: 'Client' });
  const long = nodeMetrics({
    ...graph.nodes[0],
    title: 'Application-owned conversation session',
    detail: 'An explanation that occupies more than one readable line.',
  });
  expect(long.height).toBeGreaterThan(short.height);
  expect(long.titles.length).toBeGreaterThan(1);
});

test('validates graph references, finite bounds, and unique identities', () => {
  expect(() => validateDiagram(graph)).not.toThrow();
  expect(() =>
    validateDiagram({ ...graph, edges: [{ ...graph.edges[0], to: 'missing' }] })
  ).toThrow(/reference/i);
  expect(() =>
    validateDiagram({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] })
  ).toThrow(/duplicate/i);
  expect(() => validateDiagram({ ...graph, width: NaN })).toThrow(/bounds/i);
  expect(() =>
    validateDiagram({
      ...graph,
      nodes: [{ ...graph.nodes[0], y: 290 }, graph.nodes[1]],
    })
  ).toThrow(/bounds/i);
  expect(() =>
    validateDiagram({
      ...graph,
      edges: [
        {
          ...graph.edges[0],
          points: [
            [0, 0],
            [700, 0],
          ],
        },
      ],
    })
  ).toThrow(/bounds/i);
});

test('sequence rows accommodate wrapped messages and reject unknown participants', () => {
  const sequence = {
    kind: 'sequence' as const,
    title: 'A decision',
    caption: 'A pause.',
    description: 'The person decides.',
    participants: [
      { id: 'runtime', title: 'Runtime' },
      { id: 'person', title: 'Person' },
    ],
    messages: [
      {
        from: 'runtime',
        to: 'person',
        label: 'A long request with enough context to need multiple lines',
      },
      { from: 'person', to: 'runtime', label: 'Decision' },
    ],
  };
  const layout = sequenceLayout(sequence);
  expect(layout.messages[0].lines.length).toBeGreaterThan(1);
  expect(layout.messages[1].y - layout.messages[0].y).toBeGreaterThanOrEqual(
    76
  );
  expect(() => validateDiagram(sequence)).not.toThrow();
  expect(() =>
    validateDiagram({
      ...sequence,
      messages: [{ from: 'missing', to: 'person', label: 'Request' }],
    })
  ).toThrow(/reference/i);
});
