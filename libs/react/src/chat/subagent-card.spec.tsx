import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SubagentCard, type SubagentInfo, type SubagentStatus } from './index';

afterEach(cleanup);

const child = (extra: Partial<SubagentInfo> = {}): SubagentInfo => ({
  id: 'child',
  name: 'reference-reader',
  status: 'complete',
  messages: [
    {
      id: 'm1',
      reasoning: 'Compare both guides',
      text: 'Reading the references',
      activities: [
        {
          id: 'c1',
          name: 'read_reference',
          label: 'Reading a reference',
          phase: 'complete',
          argumentsText: '{"id":"signals"}',
          resultText: 'Signals guide',
        },
      ],
    },
    { id: 'm2', text: 'Both read.' },
  ],
  ...extra,
});

describe('SubagentCard', () => {
  it('summarises the child closed, with its messages and tool activity behind the disclosure', () => {
    const view = render(<SubagentCard subagent={child()} />);
    const card = view.container.querySelector('.tp-subagent-card')!;
    expect(card.getAttribute('data-status')).toBe('complete');
    const details = card.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe(
      'reference-readerComplete2 messages'
    );
    const messages = details.querySelectorAll('.tp-subagent-card__message');
    expect(messages).toHaveLength(2);
    expect(messages[0].textContent).toContain('Compare both guides');
    expect(messages[0].textContent).toContain('Reading the references');
    const activity = messages[0].querySelector('.tp-tool-activity')!;
    expect(activity.getAttribute('data-tool-id')).toBe('c1');
    expect(activity.textContent).toContain('Reading a reference');
    expect(messages[1].querySelector('.tp-tool-activity')).toBeNull();
    // The spawning call's ID means nothing to a reader and is not shown.
    expect(card.textContent).not.toContain('child');
  });

  it.each<[SubagentStatus, string]>([
    ['pending', 'Pending'],
    ['running', 'Running'],
    ['complete', 'Complete'],
    ['error', 'Failed'],
    ['unknown', 'Status unavailable'],
  ])('labels status %s as %s', (status, label) => {
    const view = render(<SubagentCard subagent={child({ status })} />);
    expect(
      view.container.querySelector('.tp-subagent-card__status')!.textContent
    ).toBe(label);
    expect(view.queryAllByRole('alert')).toHaveLength(
      status === 'error' ? 1 : 0
    );
  });

  it('falls back to a generic name, counts one message in the singular and shows a description', () => {
    const view = render(
      <SubagentCard
        subagent={child({
          name: undefined,
          description: 'Reads both guides',
          messages: [{ id: 'm1' }],
        })}
      />
    );
    expect(view.container.querySelector('summary')!.textContent).toBe(
      'SubagentComplete1 message'
    );
    expect(
      view.container.querySelector('.tp-subagent-card__description')!
        .textContent
    ).toBe('Reads both guides');
    expect(view.container.querySelector('.tp-subagent-card__text')).toBeNull();
  });

  it('shows safe failure copy outside the disclosure and lets the app own child text', () => {
    const view = render(
      <SubagentCard
        subagent={child({ status: 'error', errorSummary: 'The reader stopped.' })}
        className="mine"
        renderText={(message) => <em>{message.text?.toUpperCase()}</em>}
      />
    );
    const alert = view.getByRole('alert');
    expect(alert.textContent).toBe('The reader stopped.');
    expect(alert.closest('details')).toBeNull();
    expect(view.container.querySelector('.tp-subagent-card.mine')).toBeTruthy();
    expect(view.container.querySelector('em')!.textContent).toBe(
      'READING THE REFERENCES'
    );
    expect(view.container.querySelector('.tp-subagent-card__text')).toBeNull();
  });
});
