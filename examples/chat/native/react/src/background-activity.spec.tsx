import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BackgroundActivity } from './background-activity';
import type { ApplicationSnapshot } from '../../shared/application';

type Observations = NonNullable<ApplicationSnapshot['runtime']>['subgraphs'];
const observation = (
  namespace: readonly string[],
  content = ''
): Observations[number] => ({
  namespace,
  messages: [
    {
      id: 'same',
      role: 'assistant',
      content,
      delivery: { generation: 'one', phase: 'complete', outcome: 'success' },
    },
  ],
  values: undefined,
  interrupts: [],
});
afterEach(cleanup);
describe('native BackgroundActivity', () => {
  it('renders no invented activity for an empty collection', () => {
    const view = render(<BackgroundActivity observations={[]} />);
    expect(view.container.textContent).toBe('');
  });
  it('presents supplied literal text and notices without child commands or protocol labels', () => {
    const observations: Observations = [
      observation(['private:node'], '<script>literal()</script>\n\n**Plain**'),
      {
        ...observation(['pending']),
        messages: [],
        interrupts: [{ id: 'child', value: 'Respond?' }],
      },
      {
        ...observation(['failed']),
        error: {
          kind: 'server',
          message: '<b>Observed error</b>',
          retryable: false,
        },
      },
    ];
    const view = render(<BackgroundActivity observations={observations} />);
    expect(
      view.getByText('<script>literal()</script>\n\n**Plain**', {
        exact: true,
        normalizer: (text) => text,
      }).textContent
    ).toBe(observations[0].messages[0].content);
    expect(view.container.querySelector('script')).toBeNull();
    expect(
      view.getByText(
        'Background work has requested a response. This example cannot respond here.'
      )
    ).toBeTruthy();
    expect(
      view.getByText('<b>Observed error</b>', { exact: true })
    ).toBeTruthy();
    expect(view.container.textContent).not.toContain('private:node');
    expect(view.queryByRole('button')).toBeNull();
  });
  it('keeps distinct full-namespace disclosures and same-ID rows through updates and reorder', () => {
    const first = observation(['a|b'], 'First');
    const second = observation(['a', 'b'], 'Second');
    const view = render(<BackgroundActivity observations={[first, second]} />);
    const firstRow = view.getByText('First').closest('li');
    const firstDisclosure = firstRow?.closest('details');
    expect(firstDisclosure).toBeTruthy();
    firstDisclosure!.open = true;
    view.rerender(
      <BackgroundActivity
        observations={[second, observation(['a|b'], 'Updated')]}
      />
    );
    expect(view.getByText('Updated').closest('li')).toBe(firstRow);
    expect(view.getByText('Updated').closest('details')).toBe(firstDisclosure);
    expect(firstDisclosure!.open).toBe(true);
    expect(view.getByText('Second')).toBeTruthy();
    view.rerender(<BackgroundActivity observations={[]} />);
    expect(firstDisclosure!.isConnected).toBe(false);
  });
});
