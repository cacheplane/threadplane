import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInterruptsApplication,
  type InterruptSession,
} from './application';
import { InterruptsDemo } from './app';

const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
beforeEach(() => factory.mockReset());
function setup(
  payload: unknown = {
    kind: 'refund_approval',
    amount: 47.5,
    customer_id: 'cus_a8x2k',
    reason: '<script>literal reason</script>',
  }
) {
  let finish!: (value: 'success') => void;
  const result = new Promise<'success'>((resolve) => {
    finish = resolve;
  });
  const batch = Object.freeze([{ id: 'refund', value: payload }]);
  let interrupts: readonly { value: unknown }[] = batch;
  const session: InterruptSession = {
    getSnapshot: () => ({
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts,
    }),
    subscribe: () => () => undefined,
    submit: vi.fn(async () => 'paused'),
    resume: vi.fn(() => result),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  factory.mockImplementation(() =>
    createInterruptsApplication({
      createThread: async () => 'confirmed',
      sessionFactory: () => session,
    })
  );
  const view = render(
    <InterruptsDemo
      connection={{ apiUrl: 'https://example.test', headers: {} }}
      onReady={() => undefined}
    />
  );
  async function pause() {
    fireEvent.change(
      view.getByRole('textbox', { name: 'Message', exact: true }),
      { target: { value: 'Refund request' } }
    );
    fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() => expect(session.submit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(view.getByRole('status').textContent).toMatch(
        /approval|new conversation/i
      )
    );
  }
  return {
    view,
    session,
    pause,
    async complete() {
      interrupts = Object.freeze([]);
      await act(async () => {
        finish('success');
      });
    },
  };
}
describe('native React refund approval', () => {
  it('keeps the admitted decision status through a synchronous duplicate click', async () => {
    const s = setup();
    await s.pause();
    const button = s.view.getByRole('button', { name: 'Approve refund' });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(s.session.resume).toHaveBeenCalledTimes(1);
    expect(s.view.getByRole('status').textContent).toBe('Sending decision…');
  });
  it('presents text-only refund fields and blocks the paused composer', async () => {
    const s = setup();
    await s.pause();
    expect(
      s.view.getByRole('region', { name: 'Refund approval required' })
    ).toBeTruthy();
    expect(s.view.getByText('cus_a8x2k')).toBeTruthy();
    expect(s.view.getByText('$47.50')).toBeTruthy();
    expect(s.view.getByText('<script>literal reason</script>')).toBeTruthy();
    expect(s.view.container.querySelector('script')).toBeNull();
    expect(
      (
        s.view.getByRole('textbox', {
          name: 'Message',
          exact: true,
        }) as HTMLTextAreaElement
      ).disabled
    ).toBe(true);
  });
  it.each([
    ['Approve refund', true],
    ['Decline refund', false],
  ] as const)(
    'sends only the %s decision and blocks further actions while pending',
    async (label, approved) => {
      const s = setup();
      await s.pause();
      fireEvent.click(s.view.getByRole('button', { name: label }));
      expect(s.session.resume).toHaveBeenCalledWith(
        { approved },
        expect.any(Object)
      );
      expect(s.session.submit).toHaveBeenCalledTimes(1);
      expect(
        s.view.queryByRole('button', { name: 'Approve refund' })
      ).toBeNull();
      expect(
        (
          s.view.getByRole('button', {
            name: 'New conversation',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      await s.complete();
      expect(s.view.getByRole('status').textContent).toBe('Response complete.');
      expect(
        (
          s.view.getByRole('textbox', {
            name: 'Message',
            exact: true,
          }) as HTMLTextAreaElement
        ).disabled
      ).toBe(false);
    }
  );
  it('requires a nonblank finite nonnegative edit and submits an explicit edited amount', async () => {
    const s = setup();
    await s.pause();
    fireEvent.click(s.view.getByRole('button', { name: 'Edit amount' }));
    const input = s.view.getByLabelText('Refund amount (USD)');
    for (const value of ['', ' ', '-1', 'Infinity']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(
        s.view.getByRole('button', { name: 'Approve edited amount' })
      );
      expect(s.session.resume).not.toHaveBeenCalled();
    }
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(
      s.view.getByRole('button', { name: 'Approve edited amount' })
    );
    expect(s.session.resume).toHaveBeenCalledWith(
      { approved: true, amount: 0 },
      expect.any(Object)
    );
  });
  it('keeps an unsupported pause protected and offers explicit replacement', async () => {
    const s = setup({ kind: 'unknown' });
    await s.pause();
    expect(
      s.view.queryByRole('region', { name: 'Refund approval required' })
    ).toBeNull();
    expect(
      (
        s.view.getByRole('textbox', {
          name: 'Message',
          exact: true,
        }) as HTMLTextAreaElement
      ).disabled
    ).toBe(true);
    expect(
      (
        s.view.getByRole('button', {
          name: 'New conversation',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(s.view.getByRole('status').textContent).toMatch(/new conversation/i);
  });
  it('copies the existing refund prompts as explicit suggestions', async () => {
    const s = setup();
    fireEvent.click(
      s.view.getByRole('button', { name: 'Refund a duplicate charge' })
    );
    await waitFor(() =>
      expect(s.session.submit).toHaveBeenCalledWith(
        'Refund $47.50 to customer cus_a8x2k — they were charged twice for the same order.',
        expect.any(Object)
      )
    );
  });
});
