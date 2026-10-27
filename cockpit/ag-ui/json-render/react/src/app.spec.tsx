import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardDemo } from './app';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  snapshot: undefined as unknown,
}));
vi.mock('./connection', () => ({ createConnectedApplication: mocks.create }));
vi.mock('@threadplane/react', () => ({ useAgent: () => mocks.snapshot }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function fixture(update = {}) {
  mocks.snapshot = {
    native: undefined,
    projection: null,
    surfaces: [],
    busy: false,
    canSubmit: true,
    activity: 'idle',
    outcome: null,
    error: null,
    viewGeneration: 0,
    ...update,
  };
  const application = {
    getSnapshot: () => mocks.snapshot,
    submit: vi.fn(),
    newConversation: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  mocks.create.mockReturnValue(application);
  const ready = vi.fn();
  const rendered = render(
    <DashboardDemo
      connection={{ url: 'PRIVATE_ENDPOINT', label: 'Shared runtime' }}
      onReady={ready}
    />
  );
  return { application, ready, rendered };
}
it('starts lazily with native input and a nonsensitive connection label', () => {
  const { application, ready } = fixture();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toBe('Ready.');
  expect(
    screen.getByRole('region', { name: 'Runtime connection' }).textContent
  ).toContain('Shared runtime');
  expect(screen.queryByText('PRIVATE_ENDPOINT')).toBeNull();
  expect(application.submit).not.toHaveBeenCalled();
});
it('keeps literal native text, accepted layout and tool observations at their assistant owner', () => {
  const spec = {
    root: 'card',
    elements: {
      card: {
        type: 'stat_card',
        props: { label: 'On time', value: { $state: '/on_time/value' } },
      },
    },
  };
  const content = '<img src=x onerror=alert(1)> **literal**';
  fixture({
    native: {
      transcript: [
        { id: 'human', role: 'user', content },
        {
          id: 'owner',
          role: 'assistant',
          content: JSON.stringify(spec),
          toolCalls: [
            {
              id: 'render-call',
              type: 'function',
              function: {
                name: 'render_spec',
                arguments: JSON.stringify(spec),
              },
            },
          ],
        },
        {
          id: 'render-call',
          role: 'tool',
          toolCallId: 'render-call',
          content: 'rendered',
        },
        { id: 'answer', role: 'assistant', content: 'Ready.' },
      ],
    },
    projection: {
      ownerId: 'owner',
      spec,
      state: { on_time: { value: '84.2%', delta: null } },
    },
    surfaces: [{ ownerId: 'owner', spec }],
  });
  const conversation = screen.getByRole('region', { name: 'Conversation' });
  expect(within(conversation).getByText(content)).toBeTruthy();
  expect(conversation.querySelector('img')).toBeNull();
  const owner = conversation.querySelector(
    '[data-dashboard-message="owner"]'
  ) as HTMLElement;
  expect(within(owner).getByText('84.2%')).toBeTruthy();
  expect(owner.querySelector('[aria-label="Tool observation"]')).toBeTruthy();
  expect(
    within(owner).getByText('Layout source').closest('details')?.open
  ).toBe(false);
  expect(
    conversation.querySelectorAll('[data-dashboard-message]')
  ).toHaveLength(4);
  expect(
    conversation.querySelectorAll('[data-dashboard-spec-owner]')
  ).toHaveLength(1);
});
it('keeps assistant prose visible when an accepted render call returns its spec as tool data', () => {
  const spec = {
    root: 'card',
    elements: {
      card: { type: 'stat_card', props: { label: 'Flights', value: 312 } },
    },
  };
  fixture({
    native: {
      transcript: [
        {
          id: 'owner',
          role: 'assistant',
          content: 'Preparing your dashboard.',
          toolCalls: [],
        },
      ],
    },
    projection: { ownerId: 'owner', spec, state: {} },
    surfaces: [{ ownerId: 'owner', spec }],
  });
  expect(
    screen.getByText('Preparing your dashboard.').closest('details')
  ).toBeNull();
  expect(screen.getByText('312')).toBeTruthy();
});
it('does not publish an unaccepted layout from partial native arguments or state', () => {
  fixture({
    native: {
      transcript: [
        {
          id: 'owner',
          role: 'assistant',
          toolCalls: [
            {
              id: 'render',
              type: 'function',
              function: { name: 'render_spec', arguments: '{"root":' },
            },
          ],
        },
      ],
    },
    busy: true,
    canSubmit: false,
  });
  expect(screen.queryByText('84.2%')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe(
    'Updating the dashboard…'
  );
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
});
it('New and unmount delegate native lifetime to the application', () => {
  const { application, rendered } = fixture();
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(application.newConversation).toHaveBeenCalledTimes(1);
  rendered.unmount();
  expect(application.dispose).toHaveBeenCalledTimes(1);
});
it('requires New after an unconfirmed outcome and disables Send', () => {
  fixture({ canSubmit: false, error: 'The dashboard could not be confirmed.' });
  expect(
    screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByRole('status').textContent).toBe(
    'Start a new conversation to continue.'
  );
  expect(screen.getByRole('alert').textContent).toBe(
    'The dashboard could not be confirmed.'
  );
});
