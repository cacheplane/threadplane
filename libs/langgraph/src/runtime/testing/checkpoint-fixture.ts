import type { ThreadState } from '@langchain/langgraph-sdk';
import { vi } from 'vitest';
import type {
  AgentTransport,
  LangGraphSubmitOptions,
  StreamEvent,
} from '../transport.types';

export const position = (id: string) => ({
  thread_id: 'thread',
  checkpoint_id: id,
  checkpoint_ns: '' as const,
  checkpoint_map: {},
});
export function saved(
  id: string,
  messages: unknown[] = [],
  changes: Record<string, unknown> = {}
): ThreadState {
  return {
    checkpoint: position(id),
    values: { messages },
    next: [],
    tasks: [],
    created_at: '',
    parent_checkpoint: null,
    metadata: { run_id: `run-${id}` },
    ...changes,
  } as ThreadState;
}
export function checkpointEvent(state: ThreadState): StreamEvent {
  return {
    type: 'checkpoints',
    sseId: `cursor-${state.checkpoint.checkpoint_id}`,
    data: {
      config: {
        configurable: {
          ...state.checkpoint,
          run_id: state.metadata?.['run_id'],
        },
      },
      values: state.values,
      next: state.next,
      tasks: state.tasks.map(({ id, name }) => ({ id, name })),
    },
  };
}
export function fixture() {
  const source = saved('a', [
    { id: 'a-user', type: 'human', content: 'Source A' },
    { id: 'a-answer', type: 'ai', content: 'Answer A' },
  ]);
  const states = new Map([['a', source]]);
  const requests: { input: unknown; options?: LangGraphSubmitOptions }[] = [];
  const transport: AgentTransport = {
    getState: vi.fn(
      async (_thread, checkpoint) => states.get(checkpoint.checkpoint_id)!
    ),
    getHistory: vi.fn(async () => [
      saved('competing', [{ id: 'b', type: 'ai', content: 'Wrong tip' }]),
    ]),
    getRunStatus: vi.fn(async () => 'success' as const),
    joinStream: vi.fn(async function* () {
      /* retained EOF */
    }),
    stream: vi.fn(async function* (
      _assistant,
      _thread,
      input,
      _signal,
      options
    ) {
      requests.push({ input, options });
      const id = `result-${requests.length}`;
      options?.onRunCreated?.({ run_id: `run-${id}`, thread_id: 'thread' });
      const messages = [
        ...(source.values as { messages: unknown[] }).messages,
        ...(input as { messages: unknown[] }).messages,
        { id: `assistant-${id}`, type: 'ai', content: id },
      ];
      const result = saved(id, messages);
      states.set(id, result);
      yield checkpointEvent(result);
    }),
  };
  return { source, states, requests, transport };
}
