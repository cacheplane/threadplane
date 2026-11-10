import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Citations,
  citationsWithToolSources,
  StatusPanel,
  ToolActivity,
  ToolActivityGroup,
  toolOutcomes,
  type ToolActivityInfo,
} from './index';
import {
  activityFailures,
  receiptOutcomes,
  retryableToolIds,
  toolSourceCitations,
  withoutStaleRetry,
} from './tool-outcome';
afterEach(cleanup);

const read = (
  id: string,
  reference: string,
  phase: ToolActivityInfo['phase'],
  retry = true
): ToolActivityInfo => ({
  id,
  name: 'read_reference',
  phase,
  argumentsText: JSON.stringify({ id: reference }),
  errorSummary: phase === 'error' ? 'Read unavailable' : undefined,
  outcome:
    phase === 'error'
      ? {
          status: 'failed',
          text: 'Read unavailable',
          retry: retry ? { label: `Retry ${reference} read` } : undefined,
        }
      : undefined,
});

describe('toolOutcomes', () => {
  const decode = vi.fn(({ args, result }) =>
    (result as { error?: string } | null)?.error
      ? {
          status: 'failed' as const,
          text: `${(args as { id: string }).id} failed`,
        }
      : undefined
  );
  const outcome = toolOutcomes({ read_reference: decode });
  const call = (patch: Partial<ToolActivityInfo>): ToolActivityInfo => ({
    id: 'a',
    name: 'read_reference',
    phase: 'complete',
    argumentsText: '{"id":"sorted"}',
    resultText: '{"error":"x"}',
    ...patch,
  });
  it('hands a complete call of a declared tool its parsed arguments and result', () => {
    expect(outcome(call({}))).toEqual({
      status: 'failed',
      text: 'sorted failed',
    });
    expect(decode).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: { id: 'sorted' },
        result: { error: 'x' },
      })
    );
  });
  it('never runs a decoder for another tool, an unsettled call or a missing result', () => {
    decode.mockClear();
    for (const patch of [
      { name: 'other' },
      { name: 'toString' },
      { phase: 'running' as const },
      { phase: 'error' as const },
      { phase: 'stopped' as const },
      { phase: undefined },
      { resultText: undefined },
    ])
      expect(outcome(call(patch))).toBeUndefined();
    expect(decode).not.toHaveBeenCalled();
  });
  it('passes falsy and non-JSON results through literally', () => {
    const seen: unknown[] = [];
    const literal = toolOutcomes({
      read_reference: ({ args, result }) => {
        seen.push(result, args);
        return undefined;
      },
    });
    for (const resultText of ['false', '0', '""', '[]', 'null', 'plain text'])
      literal(call({ resultText, argumentsText: '{' }));
    expect(seen).toEqual([
      false,
      undefined,
      0,
      undefined,
      '',
      undefined,
      [],
      undefined,
      null,
      undefined,
      'plain text',
      undefined,
    ]);
  });
});

describe('declared retry', () => {
  it('offers a retry only for the latest failed call with the same tool and arguments', () => {
    const failed = read('a', 'sorted', 'error');
    expect([...retryableToolIds([failed])]).toEqual(['a']);
    expect([
      ...retryableToolIds(
        [failed],
        [
          failed,
          {
            ...read('b', 'sorted', 'complete'),
            argumentsText: '{ "id": "sorted" }',
          },
        ]
      ),
    ]).toEqual([]);
    expect([
      ...retryableToolIds([failed], [failed, read('b', 'signals', 'complete')]),
    ]).toEqual(['a']);
    expect([
      ...retryableToolIds([read('a', 'sorted', 'error', false)]),
    ]).toEqual([]);
  });
  it('offers nothing while any call is pending or running', () => {
    const failed = read('a', 'sorted', 'error');
    for (const phase of ['pending', 'running'] as const)
      expect(
        retryableToolIds([failed], [failed, read('b', 'signals', phase)]).size
      ).toBe(0);
  });
  it('drops a stale retry and keeps the failure', () => {
    const failed = read('a', 'sorted', 'error');
    expect(withoutStaleRetry(failed, new Set(['a']))).toBe(failed);
    expect(withoutStaleRetry(failed, new Set()).outcome).toEqual({
      status: 'failed',
      text: 'Read unavailable',
    });
  });
  it('lists identical messages once unless a call carries its own retry', () => {
    expect(
      activityFailures([
        read('a', 'one', 'error', false),
        read('b', 'two', 'error', false),
        read('c', 'three', 'error'),
      ]).map((failure) => [failure.text, failure.retry?.label])
    ).toEqual([
      ['Read unavailable', undefined],
      ['Read unavailable', 'Retry three read'],
    ]);
  });
  it('renders the retry after the explanation, outside Details, and only with a handler', () => {
    const failed = read('a', 'sorted', 'error');
    const onRetry = vi.fn();
    const view = render(
      <ToolActivityGroup
        activities={[read('ok', 'signals', 'complete'), failed]}
        onRetry={onRetry}
      />
    );
    const panel = view.container.querySelector(
      '.tp-status-panel[data-tone="danger"]'
    ) as HTMLElement;
    expect(panel.getAttribute('role')).toBe('alert');
    expect([...panel.children].map((el) => el.tagName)).toEqual([
      'P',
      'BUTTON',
    ]);
    const button = view.getByRole('button', { name: 'Retry sorted read' });
    expect(button.closest('details')).toBeNull();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0].id).toBe('a');
    view.rerender(<ToolActivityGroup activities={[failed]} />);
    expect(
      view.queryByRole('button', { name: 'Retry sorted read' })
    ).toBeNull();
    expect(view.getAllByText('Read unavailable').length).toBeGreaterThan(0);
  });
  it('hides the retry in a group while another call runs or a later call repeats it', () => {
    const failed = read('a', 'sorted', 'error');
    const onRetry = vi.fn();
    const view = render(
      <ToolActivityGroup
        activities={[failed, read('b', 'signals', 'running')]}
        onRetry={onRetry}
      />
    );
    expect(
      view.queryByRole('button', { name: 'Retry sorted read' })
    ).toBeNull();
    view.rerender(
      <ToolActivityGroup
        activities={[failed, read('b', 'sorted', 'complete')]}
        onRetry={onRetry}
      />
    );
    expect(
      view.queryByRole('button', { name: 'Retry sorted read' })
    ).toBeNull();
  });
  it('renders a single call retry after its explanation', () => {
    const onRetry = vi.fn();
    const view = render(
      <ToolActivity activity={read('a', 'sorted', 'error')} onRetry={onRetry} />
    );
    const button = view.getByRole('button', { name: 'Retry sorted read' });
    expect(button.previousElementSibling?.getAttribute('role')).toBe('alert');
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('receipts', () => {
  const saved: ToolActivityInfo = {
    id: 's',
    name: 'save_note',
    phase: 'complete',
    resultText: '{"saved":true,"id":"note-1"}',
    outcome: { status: 'receipt', text: 'Note note-1 in the local store.' },
  };
  it('shows a receipt only for a complete call and never as a result preview or alert', () => {
    expect(receiptOutcomes([saved])).toEqual([
      { id: 's', lead: 'Saved.', text: 'Note note-1 in the local store.' },
    ]);
    for (const phase of ['waiting', 'running', 'error', 'stopped'] as const)
      expect(receiptOutcomes([{ ...saved, phase }])).toEqual([]);
    const view = render(<ToolActivityGroup activities={[saved]} />);
    const panel = view.container.querySelector(
      '.tp-status-panel[data-tone="success"]'
    ) as HTMLElement;
    expect(panel.textContent).toBe('Saved.Note note-1 in the local store.');
    expect(panel.getAttribute('role')).toBeNull();
    expect(panel.closest('details')).toBeNull();
    expect(view.container.querySelector('.tp-tool-outcomes')).toBeNull();
    expect(view.queryByRole('alert')).toBeNull();
    expect(view.getByRole('status').textContent).toContain(
      'Saved. Note note-1 in the local store.'
    );
  });
  it('shows no receipt for a waiting approval', () => {
    const view = render(
      <ToolActivityGroup activities={[{ ...saved, phase: 'waiting' }]} />
    );
    expect(view.container.querySelector('.tp-status-panel')).toBeNull();
  });
  it('uses the application lead when given', () => {
    const view = render(
      <ToolActivity
        activity={{
          ...saved,
          outcome: { status: 'receipt', lead: 'Filed.', text: 'Plan 7.' },
        }}
      />
    );
    expect(
      view.container.querySelector('.tp-status-panel__lead')?.textContent
    ).toBe('Filed.');
  });
});

describe('StatusPanel', () => {
  it('renders the lead, detail and actions in order with its tone and role', () => {
    const view = render(
      <StatusPanel
        tone="warning"
        lead="Waiting for your approval."
        role="status"
        actions={<button type="button">Save note</button>}
      >
        <p>Save the comparison note?</p>
      </StatusPanel>
    );
    const panel = view.getByRole('status');
    expect(panel.getAttribute('data-tone')).toBe('warning');
    expect([...panel.children].map((el) => el.className || el.tagName)).toEqual(
      ['tp-status-panel__lead', 'P', 'tp-status-panel__actions']
    );
  });
  it('defaults to a neutral panel with no role and omits empty parts', () => {
    const view = render(<StatusPanel>Plain</StatusPanel>);
    const panel = view.container.firstElementChild as HTMLElement;
    expect(panel.getAttribute('data-tone')).toBe('neutral');
    expect(panel.hasAttribute('role')).toBe(false);
    expect(panel.children).toHaveLength(0);
  });
});

describe('toolSourceCitations', () => {
  const sources = [
    { title: 'Same page', url: 'https://angular.dev/guide/signals' },
    { title: 'toSorted', url: 'https://developer.mozilla.org/toSorted' },
    { title: 'Again', url: 'https://developer.mozilla.org/toSorted' },
    { title: 'Not a URL', url: 'nope' },
  ];
  it('adds only sources the message does not already cite and numbers them after its citations', () => {
    expect(
      toolSourceCitations(
        [{ index: 4, url: 'https://angular.dev/guide/signals' }, { index: 2 }],
        sources
      )
    ).toEqual([
      {
        id: 'tool-source:https://developer.mozilla.org/toSorted',
        index: 5,
        title: 'toSorted',
        url: 'https://developer.mozilla.org/toSorted',
      },
    ]);
  });
  it('starts at 1 when the message cites nothing', () => {
    expect(
      toolSourceCitations([], sources).map(({ index, title }) => [index, title])
    ).toEqual([
      [1, 'Same page'],
      [2, 'toSorted'],
    ]);
  });
});

describe('tool sources outside a message', () => {
  it("keeps a standalone group's declared sources as its own links", () => {
    const view = render(
      <ToolActivityGroup
        activities={[
          {
            id: 'c',
            name: 'lookup',
            phase: 'complete',
            outcome: {
              text: 'Checked',
              sources: [
                { title: 'Signals', url: 'https://angular.dev/guide/signals' },
              ],
            },
          },
        ]}
      />
    );
    expect(
      view.getByRole('link', { name: 'Signals' }).closest('.tp-tool-outcomes')
    ).toBeTruthy();
  });
});

describe('a custom composition with its own Sources panel', () => {
  const activities: ToolActivityInfo[] = [
    {
      id: 'c',
      name: 'lookup',
      phase: 'complete',
      outcome: {
        text: '',
        sources: [
          {
            title: 'Signals',
            url: 'https://angular.dev/guide/signals',
            snippet: 'Reactive values.',
            iconUrl: 'data:image/png;base64,AA==',
          },
          { title: 'Cited already', url: 'https://example.com/cited' },
        ],
      },
    },
  ];
  const own = [
    { id: 'own', index: 2, title: 'Own', url: 'https://example.com/cited' },
  ];
  it('adds declared sources to the message citations with their snippet and icon', () => {
    expect(citationsWithToolSources(own, activities)).toEqual([
      own[0],
      {
        id: 'tool-source:https://angular.dev/guide/signals',
        index: 3,
        title: 'Signals',
        url: 'https://angular.dev/guide/signals',
        snippet: 'Reactive values.',
        iconUrl: 'data:image/png;base64,AA==',
      },
    ]);
  });
  it('returns the same citations when the activities add nothing', () => {
    expect(citationsWithToolSources(own, [])).toBe(own);
    expect(
      citationsWithToolSources(own, [{ ...activities[0], phase: 'running' }])
    ).toBe(own);
  });
  it('shows each source once: in the panel, with no links or blank line under the activity', () => {
    const view = render(
      <>
        <ToolActivityGroup activities={activities} sources="panel" />
        <ToolActivity activity={activities[0]} sources="panel" />
        <Citations citations={citationsWithToolSources(own, activities)} />
      </>
    );
    expect(view.container.querySelector('.tp-tool-outcomes')).toBeNull();
    const links = view.getAllByRole('link', { name: /Signals/ });
    expect(links).toHaveLength(1);
    expect(links[0].closest('.tp-citations')).toBeTruthy();
    expect(view.getByText('Reactive values.')).toBeTruthy();
  });
});
