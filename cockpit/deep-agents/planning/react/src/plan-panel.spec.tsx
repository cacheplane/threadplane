// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PlanPanel } from './plan-panel';
afterEach(cleanup);
it('renders inert plan explanation and never invents rows', () => {
  const view = render(
    <PlanPanel
      observed={{ kind: 'missing' }}
      saved={{ kind: 'missing' }}
      phase="idle"
      notice={null}
    />
  );
  expect(view.getByText(/Ask the assistant/)).toBeTruthy();
  expect(view.queryAllByRole('listitem')).toHaveLength(0);
});
it('shows exact ordered duplicate rows and progress from displayed rows', () => {
  const items = [
    { content: 'Same', status: 'pending' },
    { content: 'Same', status: 'completed' },
    { content: '', status: 'in_progress' },
  ] as const;
  const view = render(
    <PlanPanel
      observed={{ kind: 'valid', items }}
      saved={{ kind: 'missing' }}
      phase="working"
      notice={null}
    />
  );
  expect(view.getAllByRole('listitem')).toHaveLength(3);
  expect(view.getAllByText('Same')).toHaveLength(2);
  expect(view.getByText('Untitled item')).toBeTruthy();
  expect(view.getByText('1 of 3 completed')).toBeTruthy();
  expect(items[2].content).toBe('');
});
it('valid empty is a deliberate cleared plan', () => {
  const view = render(
    <PlanPanel
      observed={{ kind: 'valid', items: [] }}
      saved={{ kind: 'valid', items: [] }}
      phase="saved"
      notice={null}
    />
  );
  expect(view.getByText('The plan is empty.')).toBeTruthy();
  expect(view.getByText('0 of 0 completed')).toBeTruthy();
});
it('terminal unfinished status is read-only and distinct from active execution', () => {
  const view = render(
    <PlanPanel
      observed={{
        kind: 'valid',
        items: [{ content: 'Finish later', status: 'in_progress' }],
      }}
      saved={{
        kind: 'valid',
        items: [{ content: 'Prior', status: 'pending' }],
      }}
      phase="unconfirmed"
      notice="Unsupported update"
    />
  );
  expect(view.getByText(/Unconfirmed update/)).toBeTruthy();
  expect(view.getByText(/does not mean/)).toBeTruthy();
  expect(view.getByText('Last saved plan')).toBeTruthy();
  expect(view.getByRole('status').textContent).toBe('Unsupported update');
  expect(view.queryByRole('checkbox')).toBeNull();
});
