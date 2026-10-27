import { describe, it, expect, vi } from 'vitest';
import type { CompleteOutcome, Message } from '@threadplane/core';
import type { NativeSnapshot } from './authority';
import type { SubagentsSession } from './application';
import { createSubagentsApplication } from './application';
const empty = () => ({
  status: 'idle',
  messages: [],
  toolCalls: [],
  values: {},
  interrupts: [],
  subgraphs: [],
});
function setup() {
  let state: NativeSnapshot = empty();
  const listeners = new Set<() => void>();
  let release: ((outcome: CompleteOutcome) => void) | undefined;
  const session = {
    getSnapshot: () => state,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    submit: vi.fn(
      () =>
        new Promise<CompleteOutcome>((r) => {
          release = r;
        })
    ),
    load: vi.fn(async () => undefined),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const client = {
    createThread: vi.fn(async () => 'owned'),
    sessionFactory: vi.fn(() => session as unknown as SubagentsSession),
    readCurrent: vi.fn(),
    readHistory: vi.fn(),
    readCheckpoint: vi.fn(),
  };
  return {
    app: createSubagentsApplication(client),
    client,
    session,
    emit: (s: NativeSnapshot) => {
      state = s;
      listeners.forEach((f) => f());
    },
    finish: () => release?.('success'),
  };
}
describe('owned application', () => {
  it('starts empty without authoring for empty drafts', async () => {
    const x = setup();
    expect(x.app.getSnapshot().rows).toEqual([]);
    expect(x.app.getSnapshot().canSubmit).toBe(true);
    await x.app.submit('   ');
    expect(x.client.createThread).not.toHaveBeenCalled();
  });
  it('admits one Send while delivery is pending', async () => {
    const x = setup();
    const first = x.app.submit('Dispatch');
    await Promise.resolve();
    await x.app.submit('Dispatch');
    expect(x.client.createThread).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(x.session.submit).toHaveBeenCalledTimes(1);
    await x.app.stop();
    x.finish();
    await first;
    expect(x.app.getSnapshot().canSubmit).toBe(false);
  });
  it('New invalidates active callbacks and resets the view', async () => {
    const x = setup();
    const first = x.app.submit('Dispatch');
    await Promise.resolve();
    await Promise.resolve();
    await x.app.newConversation();
    x.emit({
      ...empty(),
      messages: [{ id: 'foreign', role: 'user', content: 'late' }] as never,
    });
    x.finish();
    await first;
    expect(x.app.getSnapshot().threadId).toBeNull();
    expect(x.app.getSnapshot().rows).toEqual([]);
    expect(x.app.getSnapshot().canSubmit).toBe(true);
  });
  it('bounds admitted text before thread creation', async () => {
    const x = setup();
    await x.app.submit('x'.repeat(65537));
    expect(x.client.createThread).not.toHaveBeenCalled();
    expect(x.app.getSnapshot().canSubmit).toBe(false);
  });
  it('transport failure blocks another Send', async () => {
    const x = setup();
    x.session.submit.mockImplementation(async () => {
      throw Error('transport');
    });
    await x.app.submit('Dispatch');
    expect(x.app.getSnapshot().outcome).toBe('error');
    expect(x.app.getSnapshot().canSubmit).toBe(false);
  });
  it('dispose rejects stale publication', async () => {
    const x = setup();
    const first = x.app.submit('Dispatch');
    await Promise.resolve();
    await Promise.resolve();
    await x.app.dispose();
    x.finish();
    await first;
    expect(x.session.dispose).toHaveBeenCalledTimes(1);
    expect(x.client.readCurrent).not.toHaveBeenCalled();
  });
});

// Repository-contained actual Task1 native/raw compiled-graph payload.
const grounded = {
  before: {
    status: 'idle',
    messages: [
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6',
        role: 'user',
        content: 'Dispatch request.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
        ],
      },
      {
        id: '76e8ce47-7bb5-4d82-8f75-b3900eb6b8e7',
        role: 'tool',
        content:
          'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
      },
      {
        id: '740bc16f-5b17-48cd-95dd-ef8114c70112',
        role: 'tool',
        content:
          'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
      },
      {
        id: 'ecc5857c-bbaf-48bb-8e1c-a1d7b0c2d915',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
      },
      {
        id: '94a6f331-90c8-45f9-9274-4c128b8c9a38',
        role: 'tool',
        content:
          'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-final',
        role: 'assistant',
        content:
          'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory. | Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft. | Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
    ],
    toolCalls: [
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
        name: 'task',
        args: {
          description: 'Research KASE dispatch.',
          subagent_type: 'field-researcher',
        },
        status: 'complete',
        result:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
        name: 'task',
        args: {
          description: 'Research KASE dispatch.',
          subagent_type: 'weather-analyst',
        },
        status: 'complete',
        result:
          'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
        name: 'task',
        args: {
          description: 'Research KDEN dispatch.',
          subagent_type: 'field-researcher',
        },
        status: 'complete',
        result:
          'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
        name: 'task',
        args: {
          description: 'Research KDEN dispatch.',
          subagent_type: 'weather-analyst',
        },
        status: 'complete',
        result:
          'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
      },
    ],
    values: { files: {} },
    interrupts: [],
    subgraphs: [],
  },
  loaded: {
    status: 'idle',
    messages: [
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6',
        role: 'user',
        content: 'Dispatch request.',
        delivery: {
          generation: '5c43bb54-c8cf-46a6-9a7e-d162356047e6',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-dispatch',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
          '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
        ],
      },
      {
        id: 'ecc5857c-bbaf-48bb-8e1c-a1d7b0c2d915',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ecc5857c-bbaf-48bb-8e1c-a1d7b0c2d915',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
      },
      {
        id: '94a6f331-90c8-45f9-9274-4c128b8c9a38',
        role: 'tool',
        content:
          'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
        delivery: {
          generation: '94a6f331-90c8-45f9-9274-4c128b8c9a38',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
      },
      {
        id: '76e8ce47-7bb5-4d82-8f75-b3900eb6b8e7',
        role: 'tool',
        content:
          'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
        delivery: {
          generation: '76e8ce47-7bb5-4d82-8f75-b3900eb6b8e7',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
      },
      {
        id: '740bc16f-5b17-48cd-95dd-ef8114c70112',
        role: 'tool',
        content:
          'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
        delivery: {
          generation: '740bc16f-5b17-48cd-95dd-ef8114c70112',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-final',
        role: 'assistant',
        content:
          'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory. | Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft. | Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
        delivery: {
          generation: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-final',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
    ],
    toolCalls: [
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
        name: 'task',
        args: {
          description: 'Research KASE dispatch.',
          subagent_type: 'field-researcher',
        },
        status: 'complete',
        result:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
        name: 'task',
        args: {
          description: 'Research KASE dispatch.',
          subagent_type: 'weather-analyst',
        },
        status: 'complete',
        result:
          'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
        name: 'task',
        args: {
          description: 'Research KDEN dispatch.',
          subagent_type: 'field-researcher',
        },
        status: 'complete',
        result:
          'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
      },
      {
        id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
        name: 'task',
        args: {
          description: 'Research KDEN dispatch.',
          subagent_type: 'weather-analyst',
        },
        status: 'complete',
        result:
          'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
      },
    ],
    values: { files: {} },
    interrupts: [],
    subgraphs: [],
  },
  saved: {
    values: {
      messages: [
        {
          content: 'Dispatch request.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'human',
          name: null,
          id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6',
        },
        {
          content: '',
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-dispatch',
          tool_calls: [
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'weather-analyst',
              },
              id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KDEN dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KDEN dispatch.',
                subagent_type: 'weather-analyst',
              },
              id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
              type: 'tool_call',
            },
          ],
          invalid_tool_calls: [],
          usage_metadata: null,
        },
        {
          content:
            'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: 'ecc5857c-bbaf-48bb-8e1c-a1d7b0c2d915',
          tool_call_id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: '94a6f331-90c8-45f9-9274-4c128b8c9a38',
          tool_call_id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: '76e8ce47-7bb5-4d82-8f75-b3900eb6b8e7',
          tool_call_id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: '740bc16f-5b17-48cd-95dd-ef8114c70112',
          tool_call_id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory. | Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft. | Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-final',
          tool_calls: [],
          invalid_tool_calls: [],
          usage_metadata: null,
        },
      ],
      files: {},
    },
    next: [],
    checkpoint: {
      thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
      checkpoint_ns: '',
      checkpoint_id: '1f1c58c1-80ce-6646-8004-c0215aa81e30',
    },
    parent_checkpoint: {
      thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
      checkpoint_ns: '',
      checkpoint_id: '1f1c58c1-80c5-66e0-8003-d25c44495dab',
    },
    created_at: '2026-10-11T15:54:51.478785+00:00',
    metadata: {
      source: 'loop',
      step: 4,
      parents: {},
      counters_since_delta_snapshot: { messages: [4, 6], files: [1, 6] },
    },
    tasks: [],
  },
};

function actual() {
  let state: NativeSnapshot = empty();
  const callbacks = new Set<() => void>();
  let continuation: ((x: CompleteOutcome) => void) | undefined;
  const emit = (v: unknown, copy = true) => {
    state = (copy ? structuredClone(v) : v) as NativeSnapshot;
    callbacks.forEach((f) => f());
  };
  const session = {
    getSnapshot: () => state,
    subscribe: (f: () => void) => {
      callbacks.add(f);
      return () => callbacks.delete(f);
    },
    submit: vi.fn(async (): Promise<CompleteOutcome> => {
      emit(grounded.before);
      return 'success' as const;
    }),
    load: vi.fn(async () => emit(grounded.loaded)),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const client = {
    createThread: async () => grounded.saved.checkpoint.thread_id,
    sessionFactory: () => session as unknown as SubagentsSession,
    readCurrent: vi.fn(async () => structuredClone(grounded.saved)),
    readHistory: async () => [structuredClone(grounded.saved)],
    readCheckpoint: async () => structuredClone(grounded.saved),
  };
  return {
    app: createSubagentsApplication(client),
    emit,
    session,
    client,
    pending: () => {
      session.submit.mockImplementation(
        () =>
          new Promise<CompleteOutcome>((r) => {
            continuation = r;
          })
      );
    },
    finish: () => continuation?.('success'),
  };
}
it('actual canonical checkpoint grants followup and observes second-turn incremental publication', async () => {
  const x = actual();
  await x.app.submit('Dispatch request.');
  expect(x.app.getSnapshot().outcome).toBe('success');
  x.pending();
  const operation = x.app.submit('Second');
  await Promise.resolve();
  const s = structuredClone(grounded.loaded) as Omit<
    NativeSnapshot,
    'messages'
  > & { messages: Message[] };
  s.messages = [
    ...s.messages,
    {
      id: 'second',
      role: 'user',
      content: 'Second',
      delivery: {
        generation: 'second-generation',
        phase: 'complete',
        outcome: 'success',
      },
    },
  ];
  x.emit(s);
  expect(x.app.getSnapshot().rows.at(-1)?.message.content).toBe('Second');
  await x.app.stop();
  x.finish();
  await operation;
});
it('uncertain followup restores the last confirmed root rather than changed prior content', async () => {
  const x = actual();
  await x.app.submit('Dispatch request.');
  expect(x.app.getSnapshot().outcome).toBe('success');
  const previous = x.app.getSnapshot().rows.map((r) => r.message.content);
  x.pending();
  const operation = x.app.submit('Second');
  await Promise.resolve();
  const s = structuredClone(grounded.loaded) as Omit<
    NativeSnapshot,
    'messages'
  > & { messages: Message[] };
  s.messages = [
    { ...s.messages[0], content: 'Changed saved human' },
    ...s.messages.slice(1),
  ];
  s.messages = [
    ...s.messages,
    {
      id: 'second',
      role: 'user',
      content: 'Second',
      delivery: {
        generation: 'second-generation',
        phase: 'complete',
        outcome: 'success',
      },
    },
  ];
  x.emit(s);
  x.finish();
  await operation;
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  expect(x.app.getSnapshot().rows.map((r) => r.message.content)).toEqual(
    previous
  );
});

it('changed confirmed baseline is rejected before a followup dispatch', async () => {
  const x = actual();
  await x.app.submit('Dispatch request.');
  const changed = structuredClone(grounded.loaded);
  changed.messages[0].content = 'Unowned prior change';
  x.emit(changed);
  await x.app.submit('Second');
  expect(x.session.submit).toHaveBeenCalledTimes(1);
  expect(x.app.getSnapshot().rows[0].message.content).toBe('Dispatch request.');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
it('New invalidates a pending raw confirmation without installing its result', async () => {
  const x = actual();
  let finish: ((v: typeof grounded.saved) => void) | undefined;
  x.client.readCurrent.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const operation = x.app.submit('Dispatch request.');
  await Promise.resolve();
  await Promise.resolve();
  expect(x.app.getSnapshot().activity).toBe('confirming');
  await x.app.newConversation();
  finish?.(structuredClone(grounded.saved));
  await operation;
  expect(x.app.getSnapshot().threadId).toBeNull();
  expect(x.app.getSnapshot().rows).toEqual([]);
  expect(x.session.load).not.toHaveBeenCalled();
});
it('provisional incomplete catalog is confirmed using complete native and raw authority', async () => {
  const x = actual();
  const final = x.session.submit.getMockImplementation();
  if (!final) throw Error('Missing test implementation');
  x.session.submit.mockImplementation(async () => {
    x.emit({ ...grounded.before, toolCalls: [] });
    expect(x.app.getSnapshot().taskCount).toBeNull();
    return final();
  });
  await x.app.submit('Dispatch request.');
  expect(x.app.getSnapshot().outcome).toBe('success');
  expect(x.app.getSnapshot().taskCount).toBe(4);
});
it('bounded capture rejects getters without executing before Markdown projection', async () => {
  const x = actual();
  let reads = 0;
  x.session.submit.mockImplementation(async () => {
    const bad = Object.defineProperty({}, 'messages', {
      get() {
        reads++;
        return [];
      },
      enumerable: true,
    });
    x.emit(bad, false);
    return 'success';
  });
  await x.app.submit('Dispatch request.');
  expect(reads).toBe(0);
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  expect(x.app.getSnapshot().rows).toEqual([]);
});
it('a resolved observed tool cannot change arguments and recover before authority', async () => {
  const x = actual();
  const final = x.session.submit.getMockImplementation();
  if (!final) throw Error('Missing fixture');
  x.session.submit.mockImplementation(async () => {
    x.emit(grounded.before);
    const changed = structuredClone(grounded.before);
    changed.toolCalls[0].args.description += ' changed';
    x.emit(changed);
    return final();
  });
  await x.app.submit('Dispatch request.');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  expect(x.app.getSnapshot().outcome).toBe('error');
});
it('native success alone cannot save a foreign raw checkpoint', async () => {
  const x = actual();
  const raw = structuredClone(grounded.saved);
  raw.checkpoint.thread_id = 'foreign';
  x.client.readCurrent.mockResolvedValue(raw);
  await x.app.submit('Dispatch request.');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  expect(x.app.getSnapshot().outcome).toBe('error');
});
it('still-owned source mutation at publication ends with visible uncertainty', async () => {
  const x = actual();
  x.session.load.mockImplementation(async () => {
    x.emit(grounded.loaded);
    const stable = structuredClone(grounded.loaded) as NativeSnapshot;
    let reads = 0;
    x.session.getSnapshot = () => (++reads === 1 ? stable : { ...stable });
  });
  await x.app.submit('Dispatch request.');
  expect(x.app.getSnapshot().outcome).toBe('error');
  expect(x.app.getSnapshot().error).toContain('could not be confirmed');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
