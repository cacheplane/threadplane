import { describe, it, expect } from 'vitest';
import { ConversationBudget, LIMITS } from './authority';
import { ChildObservations } from './children';

// Actual incremental native child snapshots: finalized call IDs grow during streaming.
const actualSequence = [
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
      {
        id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
        role: 'assistant',
        content: 'Observed lookup: ',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
      {
        id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
        role: 'assistant',
        content: 'Observed lookup: KASE field elevat',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
      {
        id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
        role: 'assistant',
        content: 'Observed lookup: KASE field elevation is 7820 ft. |',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
      {
        id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
        role: 'assistant',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest run',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
      {
        id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
        role: 'assistant',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
      {
        id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
        role: 'assistant',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'streaming',
        },
        name: 'field-researcher',
        toolCallIds: [],
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
  {
    namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
    messages: [
      {
        id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
        role: 'user',
        content: 'Research KASE dispatch.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
        ],
      },
      {
        id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
        role: 'tool',
        content: 'KASE field elevation is 7820 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_field_elevation',
        toolCallId:
          '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
      },
      {
        id: '10b395bf-3545-443d-9686-2daeebcf989f',
        role: 'tool',
        content: 'KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'lookup_runway_length',
        toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      },
      {
        id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
        role: 'assistant',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'field-researcher',
        toolCallIds: [],
      },
    ],
    values: { files: {} },
    interrupts: [],
  },
];
it('accepts every source-grounded incremental child update through parent closure', () => {
  const t = tracker();
  for (const c of actualSequence) expect(t.observe([c], context)).toBe(true);
  t.finish('success');
  expect(t.rows()[0].status).toBe('Observed response');
});
describe('child causal and exact limits', () => {
  it('rejects malformed optional metadata rather than coercing it to display text', () => {
    const t = tracker();
    const c = clone(grounded);
    Object.assign(c.messages[0], { name: 123 });
    expect(t.observe([c], context)).toBe(false);
  });
  it('marks active empty child disappearance incomplete while retaining observations', () => {
    const t = tracker();
    t.observe([grounded], context);
    expect(t.observe([], context)).toBe(false);
    expect(t.rows()[0].status).toBe('Incomplete');
  });
  it('accepts overlapping IDs between different namespaces', () => {
    const t = tracker();
    const c = clone(grounded);
    c.namespace = ['other|namespace'];
    expect(t.observe([grounded, c], context)).toBe(true);
    expect(t.rows()).toHaveLength(2);
  });
  it('marks missing namespace in a nonempty update incomplete', () => {
    const t = tracker();
    const c = clone(grounded);
    c.namespace = ['other'];
    expect(t.observe([grounded, c], context)).toBe(true);
    expect(t.observe([grounded], context)).toBe(false);
    expect(t.rows()[0].status).toBe('Incomplete');
  });
  it('never labels an unfinished child transcript observed response solely from parent success', () => {
    const t = tracker();
    const c = clone(grounded);
    (c.messages[4].delivery as { phase: string; outcome?: string }).phase =
      'streaming';
    delete (c.messages[4].delivery as { outcome?: string }).outcome;
    expect(t.observe([c], context)).toBe(true);
    t.finish('success');
    expect(t.rows()[0].status).toBe('Incomplete');
  });
  it('bounds joined transcript exactly including role labels', () => {
    const t = tracker();
    const c = clone(grounded);
    c.messages = c.messages.slice(0, 1);
    c.messages[0].content = 'x'.repeat(LIMITS.fieldText - 'user: '.length);
    expect(t.observe([c], context)).toBe(true);
    const next = tracker();
    c.messages[0].content += 'x';
    expect(next.observe([c], context)).toBe(false);
  });
  it('bounds child data before evaluating getters and retains a visible incomplete state', () => {
    const t = tracker();
    let reads = 0;
    const c = clone(grounded);
    Object.defineProperty(c, 'messages', {
      get() {
        reads++;
        return [];
      },
      enumerable: true,
    });
    expect(t.observe([c], context)).toBe(false);
    expect(reads).toBe(0);
    expect(t.incomplete).toBe(true);
  });
  it('preserves prior rows when New begins an independent turn', () => {
    const t = tracker();
    t.observe([grounded], context);
    expect(t.begin('next', 'next')).toBe(true);
    expect(t.rows()[0].status).toBe('Incomplete');
    expect(t.observe([grounded], context)).toBe(false);
  });
});
// Actual native child namespace with user/assistant/tool roles and files values.
const grounded = {
  namespace: ['tools:206fa38f-48d9-a519-b32a-e7a283a02320'],
  messages: [
    {
      id: '0db062fb-a2e1-463c-9c7c-d7e2976600a9',
      role: 'user',
      content: 'Research KASE dispatch.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
    },
    {
      id: 'lc_run--01a12bac-8e75-7cc0-8ace-09f351b5bdbf',
      role: 'assistant',
      content: '',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'field-researcher',
      toolCallIds: [
        '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
        '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
      ],
    },
    {
      id: 'e6f430b3-5f62-45af-9c74-2affb942feaa',
      role: 'tool',
      content: 'KASE field elevation is 7820 ft.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'lookup_field_elevation',
      toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_field_elevation',
    },
    {
      id: '10b395bf-3545-443d-9686-2daeebcf989f',
      role: 'tool',
      content: 'KASE longest runway is 8006 ft.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'lookup_runway_length',
      toolCallId: '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
    },
    {
      id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab408f26f214',
      role: 'assistant',
      content:
        'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'field-researcher',
      toolCallIds: [],
    },
  ],
  values: { files: {} },
  interrupts: [],
};
const clone = <T>(x: T): T => structuredClone(x);
const context = {
  owner: 'view',
  turn: 'turn',
  generation: grounded.messages[0].delivery.generation,
};
function tracker(budget = new ConversationBudget()) {
  const t = new ChildObservations('view', budget);
  expect(t.begin(context.turn, context.generation)).toBe(true);
  return t;
}
describe('retained child observations', () => {
  it('captures actual roles and literal transcript without guessing task association', () => {
    const t = tracker();
    expect(t.observe([grounded], context)).toBe(true);
    const row = t.rows()[0];
    expect(row.namespace).toEqual(grounded.namespace);
    expect(row.text).toContain('Research KASE dispatch.');
    expect(row.text).toContain('KASE field elevation');
    expect(row.messages).toHaveLength(5);
    expect(row).not.toHaveProperty('taskId');
    t.finish('success');
    expect(t.rows()[0].status).toBe('Observed response');
  });
  it('retains observations when session.load clears native children', () => {
    const t = tracker();
    t.observe([grounded], context);
    t.finish('success');
    expect(t.observe([], context)).toBe(false);
    expect(t.rows()).toHaveLength(1);
  });
  it('scopes same namespace/message IDs independently across turns and child/root namespaces', () => {
    const t = tracker();
    t.observe([grounded], context);
    t.finish('success');
    t.begin('second', 'second-generation');
    const c = clone(grounded);
    c.messages.forEach((m) => (m.delivery.generation = 'second-generation'));
    expect(
      t.observe([c], {
        owner: 'view',
        turn: 'second',
        generation: 'second-generation',
      })
    ).toBe(true);
    expect(t.rows()).toHaveLength(2);
    expect(t.rows()[0].key).not.toBe(t.rows()[1].key);
  });
  it('ignores stale owner/generation updates without contaminating current observations', () => {
    const t = tracker();
    expect(t.observe([grounded], { ...context, generation: 'stale' })).toBe(
      false
    );
    expect(t.incomplete).toBe(false);
    expect(t.observe([grounded], context)).toBe(true);
  });
  it.each(['aborted', 'interrupted', 'error', 'new'])(
    'marks interrupted %s delivery visibly',
    (outcome) => {
      const t = tracker();
      t.observe([grounded], context);
      t.finish(outcome);
      expect(t.rows()[0].status).toBe(
        outcome === 'aborted' ? 'Stopped' : 'Incomplete'
      );
    }
  );
  it('rejects shortened and completed-mutated transcripts retaining an incomplete row', () => {
    for (const mutation of ['shortened', 'changed']) {
      const t = tracker();
      t.observe([grounded], context);
      const c = clone(grounded);
      if (mutation === 'shortened') c.messages.pop();
      else c.messages[4].content += 'changed';
      expect(t.observe([c], context)).toBe(false);
      expect(t.rows()[0].status).toBe('Incomplete');
    }
  });
  it('does not upgrade child errors by parent success', () => {
    const t = tracker();
    const c = { ...clone(grounded), error: { message: 'child failed' } };
    t.observe([c], context);
    t.finish('success');
    expect(t.rows()[0].status).toBe('Incomplete');
  });
  it('supports streaming prefix growth and rejects rewrites', () => {
    const t = tracker();
    const c = clone(grounded);
    c.messages = c.messages.slice(0, 1);
    (c.messages[0].delivery as { phase: string; outcome?: string }).phase =
      'streaming';
    delete (c.messages[0].delivery as { outcome?: string }).outcome;
    c.messages[0].content = 'Research';
    expect(t.observe([c], context)).toBe(true);
    c.messages[0].content = 'Research KASE';
    expect(t.observe([c], context)).toBe(true);
    c.messages[0].content = 'Other';
    expect(t.observe([c], context)).toBe(false);
  });
  it('bounds namespace component/depth, duplicate paths, transcript and cumulative namespaces', () => {
    for (const namespace of [new Array(17).fill('x'), ['x'.repeat(1025)]]) {
      const t = tracker();
      expect(t.observe([{ ...grounded, namespace }], context)).toBe(false);
      expect(t.incomplete).toBe(true);
    }
    const t = tracker();
    expect(t.observe([grounded, grounded], context)).toBe(false);
    const b = new ConversationBudget();
    b.replace('old', 0, 100, 0);
    expect(tracker(b).observe([grounded], context)).toBe(false);
  });
  it('shares the one MiB conversation display budget with parents', () => {
    const b = new ConversationBudget();
    b.replace('parents', 1, 0, LIMITS.displayText);
    expect(tracker(b).observe([grounded], context)).toBe(false);
  });
});
