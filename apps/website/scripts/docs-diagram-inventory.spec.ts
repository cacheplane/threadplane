// @vitest-environment node
import { expect, test } from 'vitest';
import {
  diagramPlacements,
  readReactNarrative,
  discoverDiagramRoutes,
} from './docs-diagram-inventory';
import { resolve } from 'node:path';

test('inventory preserves repeated real placements while ignoring fences, inline examples and comments', () => {
  const source =
    '<TurnSequence />\n```mdx\n<TurnSequence />\n```\n~~~mdx\n<RunState />\n~~~\n`<RunState />`\n<!-- <RunState /> -->\n<TurnSequence\n />\n<RunState />';
  expect(diagramPlacements(source, ['TurnSequence', 'RunState'])).toEqual([
    'TurnSequence',
    'TurnSequence',
    'RunState',
  ]);
});

test('excluded prose cannot concatenate into an invented diagram placement', () => {
  expect(
    diagramPlacements(
      '<Turn<!-- note -->Sequence />\n<Turn{/* note */}Sequence />\n<Turn`example`Sequence />',
      ['TurnSequence']
    )
  ).toEqual([]);
});

test('React narrative extraction reads a literal template and fails unsupported dynamic prose', () => {
  expect(
    readReactNarrative('const source = `A \\`word\\` <TurnSequence />`;')
  ).toBe('A `word` <TurnSequence />');
  expect(() => readReactNarrative('const source = makeContent();')).toThrow(
    /literal/
  );
});

test('every live authored diagram placement is represented with its source and expected count', () => {
  const targets = discoverDiagramRoutes(
    resolve(import.meta.dirname, '../../..')
  );
  expect(
    targets.find(
      (target) => target.path === '/docs/langgraph/getting-started/introduction'
    )?.diagrams.length
  ).toBeGreaterThan(0);
  expect(new Set(targets.map((target) => target.path)).size).toBe(
    targets.length
  );
  for (const target of targets) {
    expect(target.source).toMatch(/\.(mdx|tsx)$/);
    expect(target.diagrams.length).toBeGreaterThan(0);
  }
});
