import { describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import type {
  ToolExecutionAcquisition,
  ToolExecutionStore,
} from '@threadplane/core/tools';
import { createSession } from './create-session';
import type { AgentTransport } from './transport.types';
import { deferred } from './testing/deferred';

const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
const assistant = {
  type: 'ai',
  id: 'assistant',
  content: '',
  tool_calls: [{ id: 'call', name: 'work', args: { secret: 'sensitive' } }],
};
function fixture() {
  const acquisition = deferred<ToolExecutionAcquisition>();
  const entered = deferred<void>();
  const acquire = vi.fn<ToolExecutionStore['acquire']>(() => {
    entered.resolve();
    return acquisition.promise;
  });
  const settle = vi.fn<ToolExecutionStore['settle']>(async () => 'accepted');
  const handler = vi.fn(() => 'never');
  const updateState = vi.fn(async () => undefined);
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield { type: 'values', data: { messages: [assistant] } };
  });
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () =>
      [
        {
          values: {
            messages: [
              assistant,
              {
                type: 'tool',
                id: 'wire',
                tool_call_id: 'call',
                content: 'saved',
              },
            ],
          },
          next: [],
          tasks: [],
        },
      ] as unknown as ThreadState[]
  );
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    executionStore: { acquire, settle },
    transport: { stream, updateState, getHistory },
    tools: { work: { description: 'Work', handler } },
  });
  return {
    session,
    acquisition,
    entered,
    acquire,
    settle,
    handler,
    updateState,
    stream,
    getHistory,
  };
}
describe('durable conflict session facts', () => {
  it.each(['live', 'stop', 'dispose'] as const)(
    'retains a conflict discovered after %s and never fabricates a result',
    async (phase) => {
      const f = fixture();
      let publications = 0;
      const off = f.session.subscribe(() => publications++);
      try {
        const run = f.session.submit('Go');
        await f.entered.promise;
        if (phase !== 'live') await f.session[phase]();
        const before = publications;
        f.acquisition.resolve({ status: 'conflict' });
        await run;
        await drain();
        expect(f.handler).not.toHaveBeenCalled();
        expect(f.settle).not.toHaveBeenCalled();
        expect(f.updateState).not.toHaveBeenCalled();
        expect(f.stream).toHaveBeenCalledTimes(1);
        if (phase === 'dispose') expect(publications).toBe(before);
        else {
          expect(f.session.getSnapshot().error?.message).toMatch(
            /identity conflict/
          );
          expect(f.session.getSnapshot().error?.message).not.toContain(
            'sensitive'
          );
          await expect(f.session.submit('Bypass')).rejects.toThrow(
            /identity conflict/
          );
          await f.session.load?.();
          expect(f.session.getSnapshot().error?.message).toMatch(
            /identity conflict/
          );
          await expect(
            f.session.submit('Bypass after successful history recovery')
          ).rejects.toThrow(/identity conflict/);
          expect(f.stream).toHaveBeenCalledTimes(1);
        }
      } finally {
        off();
        f.acquisition.resolve({ status: 'conflict' });
        await f.session.dispose();
      }
    }
  );
});
