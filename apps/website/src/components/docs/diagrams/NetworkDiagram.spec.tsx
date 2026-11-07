// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { NetworkDiagram } from './NetworkDiagram';
import {
  agUiArchitecture,
  agUiInterrupts,
  agUiSubagents,
} from './ag-ui-diagrams';
import { validateDiagram } from './diagram-model';

afterEach(cleanup);
test('all teaching definitions validate and render named images with text alternatives', () => {
  for (const definition of [agUiArchitecture, agUiInterrupts, agUiSubagents]) {
    expect(() => validateDiagram(definition)).not.toThrow();
    const view = render(<NetworkDiagram definition={definition} />);
    expect(view.getByRole('img', { name: definition.title })).toBeTruthy();
    expect(view.getByText(definition.description)).toBeTruthy();
    view.unmount();
  }
});
test('network rendering distinguishes request and returned-data paths without SVG IDs', () => {
  const { container } = render(
    <>
      <NetworkDiagram definition={agUiArchitecture} />
      <NetworkDiagram definition={agUiArchitecture} />
    </>
  );
  expect(container.querySelectorAll('svg [id]')).toHaveLength(0);
  expect(container.querySelectorAll('svg [data-return="true"]')).toHaveLength(
    4
  );
  expect(container.textContent).toContain('@threadplane/chat');
  expect(container.textContent).toContain('AbstractAgent');
});
test('sequences draw participant lifelines and delegation makes ordered dispatch explicit', () => {
  const sequence = render(<NetworkDiagram definition={agUiInterrupts} />);
  expect(
    sequence.container.querySelectorAll('.tp-network-lifeline')
  ).toHaveLength(3);
  const messageLabels = [
    ...sequence.container.querySelectorAll('.tp-network-edge-label'),
  ].map((label) =>
    [...label.querySelectorAll('tspan')].map((line) => line.textContent).join(' ')
  );
  expect(messageLabels).toContain('4. Submit the decision');
  sequence.unmount();
  const flow = render(<NetworkDiagram definition={agUiSubagents} />);
  for (const label of [
    '1. Research',
    '2. Booking',
    '3. Itinerary',
    'one at a time',
    'subagentRunId',
    'parentToolCallId',
  ])
    expect(flow.container.textContent).toContain(label);
});
