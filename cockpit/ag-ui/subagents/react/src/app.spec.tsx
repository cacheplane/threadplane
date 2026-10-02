import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SubagentsDemo } from './app';
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
const card = {
  id: 'call-sub',
  runId: 'run',
  ownerId: 'owner',
  callId: 'call',
  role: 'research',
  phase: 'running',
  messages: [{ id: 'call-sub-m1', text: '<img src=x> **literal specialist**' }],
  answer: null,
};
const owner = {
  id: 'owner',
  role: 'assistant',
  content: '',
  toolCalls: [
    {
      id: 'call',
      type: 'function',
      function: {
        name: 'task',
        arguments: '{"role":"research","task_description":"A fictional trip."}',
      },
    },
  ],
};
function fixture(update = {}) {
  mocks.snapshot = {
    cards: [],
    native: undefined,
    busy: false,
    canSubmit: true,
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
    <SubagentsDemo
      connection={{ url: 'PRIVATE_ENDPOINT', label: 'Shared runtime' }}
      onReady={ready}
    />
  );
  return { application, ready, rendered };
}
it('shows ready lazy native input and keeps the endpoint private', () => {
  const { ready, application } = fixture();
  expect(ready).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toBe('Ready.');
  expect(screen.queryByText('PRIVATE_ENDPOINT')).toBeNull();
  expect(application.submit).not.toHaveBeenCalled();
});
it('anchors literal child text to the original call without duplicating it in root bubbles', () => {
  fixture({
    busy: true,
    canSubmit: false,
    cards: [card],
    native: {
      transcript: [
        { id: 'human', role: 'user', content: 'Plan' },
        owner,
        {
          id: 'call-sub-m1',
          role: 'assistant',
          subagentRunId: 'call-sub',
          content: card.messages[0].text,
        },
      ],
    },
  });
  const conversation = screen.getByRole('region', { name: 'Conversation' });
  const anchored = conversation.querySelector('[data-parent-message="owner"]')!;
  expect(
    within(anchored as HTMLElement).getByRole('heading', {
      name: 'Research specialist',
    })
  ).toBeTruthy();
  expect(screen.getAllByText(card.messages[0].text)).toHaveLength(1);
  expect(conversation.querySelectorAll('img')).toHaveLength(0);
  expect(conversation.querySelectorAll('[data-parent-message]')).toHaveLength(
    2
  );
  expect(
    screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
  ).toBe(true);
});
it('renders completed result fallback after a blank start without fabricating streamed text', () => {
  fixture({
    cards: [
      {
        ...card,
        phase: 'complete',
        messages: [{ id: 'call-sub-m1', text: '' }],
        answer: 'Completed without tokens.',
      },
    ],
    native: {
      transcript: [
        owner,
        {
          id: 'call',
          role: 'tool',
          toolCallId: 'call',
          content: 'Completed without tokens.',
        },
      ],
    },
  });
  expect(
    screen.getByRole('region', { name: 'Research specialist' }).textContent
  ).toContain('Completed without tokens.');
  expect(screen.getByText('Complete')).toBeTruthy();
});
it('never renders private child error or failed raw tool payloads', () => {
  fixture({
    canSubmit: false,
    cards: [{ ...card, phase: 'error', messages: [] }],
    error: 'Start a new conversation.',
    native: {
      run: { outcome: 'error', terminal: { message: 'PRIVATE ROOT ERROR' } },
      transcript: [
        owner,
        {
          id: 'call',
          role: 'tool',
          toolCallId: 'call',
          content: 'PRIVATE TOOL ERROR',
        },
      ],
      subagents: [
        { terminal: { message: 'PRIVATE CHILD ERROR', code: 'PRIVATE' } },
      ],
    },
  });
  expect(document.body.textContent).not.toContain('PRIVATE');
  expect(
    screen.getByRole('region', { name: 'Research specialist' }).textContent
  ).toContain('The specialist could not finish.');
  expect(
    screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
  ).toBe(true);
});
it('New and unmount delegate to the native lifetime', () => {
  const { application, rendered } = fixture();
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(application.newConversation).toHaveBeenCalledOnce();
  rendered.unmount();
  expect(application.dispose).toHaveBeenCalledOnce();
});
it('retained running observations show stopped or incomplete after execution ends', () => {
  const { rendered } = fixture({
    canSubmit: false,
    outcome: 'aborted',
    cards: [{ ...card, messages: [] }],
    native: { transcript: [owner], run: { id: 'run' } },
  });
  const region = screen.getByRole('region', { name: 'Research specialist' });
  expect(region.textContent).toContain('Stopped');
  expect(region.textContent).not.toContain('Working');
  expect(region.textContent).not.toContain('Waiting');
  rendered.unmount();
  fixture({
    canSubmit: false,
    outcome: 'error',
    cards: [{ ...card, messages: [] }],
    native: { transcript: [owner], run: { id: 'run' } },
  });
  expect(
    screen.getByRole('region', { name: 'Research specialist' }).textContent
  ).toContain('Incomplete');
});
