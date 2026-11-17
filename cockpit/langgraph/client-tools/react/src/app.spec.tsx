import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { completeDelivery } from '@threadplane/core';
import { createClientToolsApplication, type ClientToolsSession, type ClientToolCatalog } from './application';
import { ClientToolsDemo } from './app';

const factory = vi.hoisted(() => vi.fn());
vi.mock('./connection', () => ({ createConnectedApplication: factory }));
afterEach(cleanup);
/** The application's own status line, below the composer. */
const statusOf = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.tp-chat-input__footer [role="status"]') as HTMLElement;
beforeEach(() => factory.mockReset());
function setup() {
  let tools!: ClientToolCatalog;
  type State = ReturnType<ClientToolsSession['getSnapshot']>;
  let state: State = { status: 'idle', messages: [], toolCalls: [], interrupts: [] };
  const session: ClientToolsSession = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit: vi.fn(async (_text, options) => {
      await tools.weather_card.handler({ location: '<script>Portland</script>', temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 }, { signal: options!.signal! });
      // The session reports the call it is about to run, then runs its handler.
      const call = { id: 'booking', name: 'confirm_booking', args: { summary: '<img src=x> Fictional booking' } };
      state = {
        ...state,
        messages: [{ id: 'request', role: 'assistant', content: 'One booking to confirm.', delivery: completeDelivery('run', 'success'), toolCallIds: [call.id] }],
        toolCalls: [{ ...call, status: 'running' }],
      } as State;
      const result = await tools.confirm_booking.handler(call.args, { signal: options!.signal! });
      state = { ...state, toolCalls: [{ ...call, status: 'complete', result }] } as State;
      return 'success';
    }),
    stop: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined),
  };
  factory.mockImplementation(() => createClientToolsApplication({
    createThread: async () => 'confirmed',
    sessionFactory: (_id, catalog) => { tools = catalog; return session; },
  }));
  const ready = vi.fn();
  const view = render(<ClientToolsDemo connection={{ apiUrl: 'https://example.test', headers: {} }} onReady={ready} />);
  async function send() {
    fireEvent.change(view.getByRole('textbox', { name: 'Message', exact: true }), { target: { value: 'Simulated request' } });
    fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Confirm booking' })).toBeTruthy());
  }
  return { view, session, ready, send };
}
it('presents native chat, simulated tools, and empty authored panels', () => {
  const h = setup();
  expect(h.view.getByRole('heading', { name: 'LangGraph client tools' })).toBeTruthy();
  expect(h.view.container.querySelector('.tp-chat-list')).toBeTruthy();
  expect(h.view.getByText('No weather panels yet.')).toBeTruthy();
  expect(h.view.queryByRole('region', { name: 'Booking decisions' })).toBeNull();
  expect(h.ready).toHaveBeenCalledTimes(1);
});
it('keeps browser decisions enabled while chat is busy and retains literal completed panels', async () => {
  const h = setup();
  await h.send();
  expect((h.view.getByRole('textbox', { name: 'Message', exact: true }) as HTMLTextAreaElement).disabled).toBe(true);
  expect((h.view.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(true);
  expect(h.view.getByText('<script>Portland</script>')).toBeTruthy();
  expect(h.view.getByText('<img src=x> Fictional booking')).toBeTruthy();
  expect(h.view.container.querySelector('script, img')).toBeNull();
  fireEvent.click(h.view.getByRole('button', { name: 'Confirm booking' }));
  await waitFor(() => expect(statusOf(h.view).textContent).toBe('Response complete.'));
  expect(h.view.queryByRole('button', { name: 'Confirm booking' })).toBeNull();
  expect(h.view.getByText('Approved: Booking')).toBeTruthy();
  expect(h.view.getByText('<script>Portland</script>')).toBeTruthy();
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
  expect(h.view.getByText('No weather panels yet.')).toBeTruthy();
  expect(h.view.queryByText('Approved: Booking')).toBeNull();
});
it('draws the waiting booking below its call, names both actions and hints the composer', async () => {
  const h = setup(); await h.send();
  const conversation = h.view.getByRole('region', { name: 'Conversation' });
  const card = conversation.querySelector('[data-tool-prompt="booking"] .tp-approval-card') as HTMLElement;
  expect(card).toBeTruthy();
  // The call keeps its own row above the card.
  const row = conversation.querySelector('.tp-tool-activity') as HTMLElement;
  expect(row.textContent).toContain('confirm_booking');
  expect(row.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.textContent).toContain('Waiting for your approval.');
  expect(card.textContent).toContain('<img src=x> Fictional booking');
  expect([...card.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Confirm booking', "Don't book"]);
  expect(document.activeElement).toBe(h.view.getByRole('button', { name: 'Confirm booking' }));
  expect(h.view.getByRole('textbox', { name: 'Message', exact: true }).getAttribute('placeholder')).toBe('Answer the booking to continue');
});
it('returns focus to the composer once the answered run completes', async () => {
  const h = setup(); await h.send();
  fireEvent.click(h.view.getByRole('button', { name: 'Confirm booking' }));
  const composer = h.view.getByRole('textbox', { name: 'Message', exact: true });
  await waitFor(() => expect(document.activeElement).toBe(composer));
  expect(composer.getAttribute('placeholder')).toBe('Ask for weather or a fictional booking…');
});
it('cancels a booking without treating cancellation as a failed conversation', async () => {
  const h = setup(); await h.send();
  fireEvent.click(h.view.getByRole('button', { name: "Don't book" }));
  await waitFor(() => expect(h.view.getByText('Declined: Booking')).toBeTruthy());
  expect(statusOf(h.view).textContent).toBe('Response complete.');
});
it('Stop revokes the pending decision and requires a replacement conversation', async () => {
  const h = setup(); await h.send();
  // The composer's Stop; a running group offers the same action.
  fireEvent.click(h.view.container.querySelector('.tp-chat-input__stop')!);
  await waitFor(() => expect(h.view.queryByRole('button', { name: 'Confirm booking' })).toBeNull());
  // A revoked booking was never answered, so it leaves no record.
  expect(h.view.queryByText(/^(Approved|Declined)/)).toBeNull();
  expect(statusOf(h.view).textContent).toMatch(/Stopped.*new conversation/);
  expect(h.session.stop).toHaveBeenCalledTimes(1);
});
it('does not construct a replacement after unmount during reset', async () => {
  const h = setup(); await h.send();
  fireEvent.click(h.view.getByRole('button', { name: "Don't book" }));
  await waitFor(() => expect(statusOf(h.view).textContent).toBe('Response complete.'));
  let finish!: () => void;
  vi.mocked(h.session.dispose).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  await act(async () => undefined);
  h.view.unmount(); await act(async () => finish());
  expect(factory).toHaveBeenCalledTimes(1);
});
