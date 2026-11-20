import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalCard, Chat } from './index';
import { useAgent } from '../use-agent';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import { decisionState } from '../../../ag-ui/src/runtime/decision';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import { bindingFixture } from '../../../ag-ui/src/runtime/testing/binding-fixture';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import { createSession } from '../../../ag-ui/src/runtime/create-session';

afterEach(cleanup);

describe('Chat over a native AG-UI session', () => {
  it('sends from the composer, streams the reply with its tool call, and shows a backend error', async () => {
    const fixture = bindingFixture();
    const session = fixture.session;
    const view = render(
      <Chat
        session={session}
        renderToolCall={(call) => (
          <p data-testid="call">
            {call.name}:{call.status}
          </p>
        )}
      />
    );
    const box = () => view.getByRole('textbox', { name: 'Message' });
    try {
      fireEvent.change(box(), { target: { value: 'Find tea' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      const exchange = await act(() => fixture.started());
      expect(exchange.body.messages.at(-1)).toMatchObject({
        role: 'user',
        content: 'Find tea',
      });
      expect(view.container.textContent).toContain('Find tea');
      expect(view.getByRole('button', { name: 'Stop' })).toBeTruthy();

      await act(async () => {
        exchange.emit({
          type: 'TOOL_CALL_START',
          toolCallId: 'c1',
          toolCallName: 'search',
          parentMessageId: 'a1',
        });
        exchange.emit({
          type: 'TOOL_CALL_ARGS',
          toolCallId: 'c1',
          delta: '{"q":"tea"}',
        });
        exchange.emit({ type: 'TOOL_CALL_END', toolCallId: 'c1' });
        exchange.emit({
          type: 'TOOL_CALL_RESULT',
          toolCallId: 'c1',
          messageId: 't1',
          content: '{"hits":2}',
        });
        exchange.emit({
          type: 'TEXT_MESSAGE_START',
          messageId: 'a2',
          role: 'assistant',
        });
        exchange.emit({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'a2',
          delta: 'Two teas found.',
        });
        exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'a2' });
        exchange.emit({
          type: 'RUN_FINISHED',
          threadId: exchange.body.threadId,
          runId: exchange.body.runId,
        });
        await fixture.changed((snapshot) => snapshot.status === 'idle');
      });
      expect(view.container.textContent).toContain('Two teas found.');
      expect(view.getByTestId('call').textContent).toBe('search:complete');
      expect(view.queryByRole('button', { name: 'Stop' })).toBeNull();

      fireEvent.change(box(), { target: { value: 'Again' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      const next = await act(() => fixture.started(1));
      expect(next.body.messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'tool',
        'assistant',
        'user',
      ]);
      await act(async () => {
        next.emit({ type: 'RUN_ERROR', message: 'Quota exceeded' });
        await fixture.changed((snapshot) => snapshot.status === 'error');
      });
      expect(view.getByRole('alert').textContent).toContain('Quota exceeded');
      expect(view.queryByRole('button', { name: 'Retry response' })).toBeNull();
      expect(view.queryByRole('button', { name: 'Check status' })).toBeNull();
    } finally {
      await act(() => fixture.cleanup());
    }
  });

  it('shows the sources the state lists for a message and resolves its markers', async () => {
    const fixture = bindingFixture({
      messages: [
        { id: 'u', role: 'user', content: 'Ask' },
        { id: 'a', role: 'assistant', content: 'Signals are reactive.[^doc]' },
      ],
      state: {
        citations: {
          a: [
            {
              id: 'doc',
              title: 'Signals guide',
              url: 'https://example.test/signals',
            },
          ],
        },
      },
    });
    const view = render(<Chat session={fixture.session} />);
    try {
      const sources = view.container.querySelector('.tp-citations');
      expect(sources?.textContent).toContain('1');
      expect(view.container.textContent).toContain('Signals are reactive.');
      expect(view.container.textContent).not.toContain('[^doc]');
    } finally {
      await act(() => fixture.cleanup());
    }
  });

  it('shows a pending approval from the native session and answers it', async () => {
    const fixture = bindingFixture();
    const native = fixture.session;
    const session = native;
    function App() {
      const pending = decisionState(useAgent(native));
      return (
        <Chat
          session={session}
          approval={
            pending?.kind === 'native' ? (
              <ApprovalCard
                title="Refund approval"
                disabled={pending.phase !== 'ready'}
                actions={[
                  {
                    id: 'approve',
                    label: 'Issue refund',
                    onSelect: () =>
                      void native.resume(
                        pending.interrupts.map((interrupt) => ({
                          interruptId: interrupt.id,
                          status: 'resolved' as const,
                          value: { approved: true },
                        }))
                      ),
                  },
                ]}
              >
                {pending.interrupts[0].reason}
              </ApprovalCard>
            ) : null
          }
        />
      );
    }
    const view = render(<App />);
    const box = () => view.getByRole('textbox');
    try {
      fireEvent.change(box(), { target: { value: 'Refund order 7' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      const exchange = await act(() => fixture.started());
      expect(view.queryByRole('button', { name: 'Issue refund' })).toBeNull();
      await act(async () => {
        exchange.emit({
          type: 'RUN_FINISHED',
          threadId: exchange.body.threadId,
          runId: exchange.body.runId,
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'approval', reason: 'Refund 20 to order 7?' }],
          },
        });
        await fixture.changed((snapshot) => snapshot.run?.outcome === 'paused');
      });
      const approve = view.getByRole('button', { name: 'Issue refund' });
      expect((approve as HTMLButtonElement).disabled).toBe(false);
      expect(view.container.textContent).toContain('Refund 20 to order 7?');
      expect(box().getAttribute('placeholder')).toBe(
        'Answer the approval to continue'
      );

      fireEvent.click(approve);
      const next = await act(() => fixture.started(1));
      expect((next.body as { resume?: unknown }).resume).toEqual([
        {
          interruptId: 'approval',
          status: 'resolved',
          payload: { approved: true },
        },
      ]);
      expect(
        (
          view.getByRole('button', {
            name: 'Issue refund',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      await act(async () => {
        next.emit({
          type: 'TEXT_MESSAGE_START',
          messageId: 'a',
          role: 'assistant',
        });
        next.emit({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'a',
          delta: 'Refund issued.',
        });
        next.emit({ type: 'TEXT_MESSAGE_END', messageId: 'a' });
        next.emit({
          type: 'RUN_FINISHED',
          threadId: next.body.threadId,
          runId: next.body.runId,
        });
        await fixture.changed(
          (snapshot) => snapshot.status === 'idle' && !snapshot.decision
        );
      });
      expect(view.queryByRole('button', { name: 'Issue refund' })).toBeNull();
      expect(view.container.textContent).toContain('Refund issued.');
      expect(fixture.exchanges).toHaveLength(2);
    } finally {
      await act(() => fixture.cleanup());
    }
  });

  it('names a rejected credential instead of a generic failure', async () => {
    const native = createSession({
      threadId: 'thread',
      url: 'https://failure.invalid/run',
      fetch: async () =>
        new Response('{"detail":"Not allowed"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const view = render(<Chat session={native} />);
    try {
      const box = view.getByRole('textbox');
      fireEvent.change(box, { target: { value: 'Hello' } });
      fireEvent.keyDown(box, { key: 'Enter' });
      const alert = await view.findByRole('alert');
      expect(alert.textContent).toContain(
        'Authentication failed. Check your credentials.'
      );
      expect(alert.textContent).not.toContain('Not allowed');
      expect(view.queryByRole('button', { name: 'Retry response' })).toBeNull();
    } finally {
      await act(() => native.dispose());
    }
  });
});
