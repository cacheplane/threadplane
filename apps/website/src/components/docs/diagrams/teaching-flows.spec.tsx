import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { NetworkDiagram } from './NetworkDiagram';
import { validateDiagram } from './diagram-model';
import {
  toolViewFlow,
  renderEventFlow,
  checkpointHistory,
} from './teaching-flows';

afterEach(cleanup);

test.each([toolViewFlow, renderEventFlow, checkpointHistory])(
  '$title renders a valid, described diagram that fits the reading column',
  (definition) => {
    expect(() => validateDiagram(definition)).not.toThrow();
    expect(definition.width).toBeLessThanOrEqual(580);
    const view = render(<NetworkDiagram definition={definition} />);
    expect(view.getByRole('img', { name: definition.title })).toBeTruthy();
    expect(view.getByText(definition.description)).toBeTruthy();
  }
);

test('flow descriptions preserve execution ownership and optional state writes', () => {
  expect(toolViewFlow.description).toContain('server executes');
  expect(toolViewFlow.description).toContain('TOOL_CALL_END');
  expect(renderEventFlow.description).toContain('may update');
  expect(
    renderEventFlow.edges.find((edge) => edge.to === 'store')?.label?.text
  ).toContain('optional');
  expect(checkpointHistory.description).toContain('not parallel execution');
});
