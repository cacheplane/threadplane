import type { Message, ToolCall } from '@threadplane/core';
import type { GenerativeUiState } from './observation';
export const layout = {
  root: 'root',
  elements: {
    root: {
      type: 'stat_card',
      props: { label: 'On-time', value: { $state: '/on_time/value' } },
    },
  },
};
export const message = (
  id: string,
  role: Message['role'],
  content: string,
  extra: Partial<Message> = {}
): Message => ({
  id,
  role,
  content,
  delivery: { generation: 'generation', phase: 'complete', outcome: 'success' },
  ...extra,
});
export function evidence() {
  const tool: ToolCall = {
    id: 'render',
    name: 'render_spec',
    args: layout,
    status: 'complete',
    result: JSON.stringify(layout),
  };
  const human = message('human', 'user', 'Show dashboard');
  const parent = message('parent', 'assistant', '', {
    toolCallIds: ['render'],
  });
  const result = message('result', 'tool', tool.result as string, {
    name: tool.name,
    toolCallId: tool.id,
  });
  const final = message('answer', 'assistant', 'Ready.');
  const before: GenerativeUiState = {
    status: 'running',
    messages: [human, parent, result],
    toolCalls: [tool],
    interrupts: [],
    subgraphs: [],
    values: {},
  };
  const after: GenerativeUiState = {
    ...before,
    status: 'idle',
    messages: [
      human,
      { ...parent, content: tool.result as string },
      { ...result, content: 'rendered' },
      final,
    ],
    values: {
      dashboard: {},
      completed_turn_id: human.id,
      completed_answer_id: final.id,
      completed_message_ids: ['human', 'parent', 'result', 'answer'],
    },
  };
  const saved: GenerativeUiState = {
    ...after,
    messages: after.messages.map((m) => ({
      ...m,
      delivery: { ...m.delivery, generation: m.id },
    })),
    toolCalls: [{ ...tool, result: 'rendered' }],
    history: [
      {
        checkpoint: {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'checkpoint',
        },
        next: [],
      },
    ],
  };
  const raw = {
    checkpoint: saved.history?.[0].checkpoint,
    next: [],
    tasks: [],
    values: {
      ...saved.values,
      messages: saved.messages.map((m) => ({
        id: m.id,
        type:
          m.role === 'user' ? 'human' : m.role === 'assistant' ? 'ai' : 'tool',
        content: m.content,
        ...(m.role === 'assistant'
          ? {
              tool_calls:
                m.toolCallIds?.map(() => ({
                  id: tool.id,
                  name: tool.name,
                  args: tool.args,
                  type: 'tool_call',
                })) ?? [],
            }
          : {}),
        ...(m.role === 'tool'
          ? { name: m.name, tool_call_id: m.toolCallId }
          : {}),
      })),
    },
  };
  return { tool, human, parent, result, final, before, after, saved, raw };
}
