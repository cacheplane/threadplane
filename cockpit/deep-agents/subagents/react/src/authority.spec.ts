import { describe, it, expect } from 'vitest';
import {
  copyData,
  literal,
  LIMITS,
  captureBaseline,
  captureTurn,
  captureAuthority,
} from './authority';

// Whole actual native aggregates, including retained child data and load history metadata.
const actualWholeNative = {
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
    subgraphs: [
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
            toolCallId:
              '0db062fb-a2e1-463c-9c7c-d7e2976600a9-lookup_runway_length',
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
      {
        namespace: ['tools:7c55ba25-2ad6-2fdf-878c-87f2c7badf1f'],
        messages: [
          {
            id: '78d9e8f6-addd-4eb6-8e2a-8c77ba1a7be8',
            role: 'user',
            content: 'Research KASE dispatch.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
          },
          {
            id: 'lc_run--01a12bac-8e75-7cc0-8ace-0a0b9934a80d',
            role: 'assistant',
            content: '',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'weather-analyst',
            toolCallIds: [
              '78d9e8f6-addd-4eb6-8e2a-8c77ba1a7be8-lookup_weather',
            ],
          },
          {
            id: '2931c1f4-5185-4cb0-ba07-51429c05488c',
            role: 'tool',
            content:
              'KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'lookup_weather',
            toolCallId: '78d9e8f6-addd-4eb6-8e2a-8c77ba1a7be8-lookup_weather',
          },
          {
            id: 'lc_run--01a12bac-8e7b-7c82-aa7e-95346cd6ba52',
            role: 'assistant',
            content:
              'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'weather-analyst',
            toolCallIds: [],
          },
        ],
        values: { files: {} },
        interrupts: [],
      },
      {
        namespace: ['tools:54051cee-1cab-ad48-5707-15aa636e63a8'],
        messages: [
          {
            id: 'e296b319-4ea9-4879-bd36-35fd6649610d',
            role: 'user',
            content: 'Research KDEN dispatch.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
          },
          {
            id: 'lc_run--01a12bac-8e75-7cc0-8ace-0a18caceabca',
            role: 'assistant',
            content: '',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'field-researcher',
            toolCallIds: [
              'e296b319-4ea9-4879-bd36-35fd6649610d-lookup_field_elevation',
              'e296b319-4ea9-4879-bd36-35fd6649610d-lookup_runway_length',
            ],
          },
          {
            id: 'bb8cd008-2387-4e62-b4e0-650377895238',
            role: 'tool',
            content: 'KDEN field elevation is 5434 ft.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'lookup_field_elevation',
            toolCallId:
              'e296b319-4ea9-4879-bd36-35fd6649610d-lookup_field_elevation',
          },
          {
            id: '7e8e152c-1cad-4152-9df0-6b5511505d06',
            role: 'tool',
            content: 'KDEN longest runway is 16000 ft.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'lookup_runway_length',
            toolCallId:
              'e296b319-4ea9-4879-bd36-35fd6649610d-lookup_runway_length',
          },
          {
            id: 'lc_run--01a12bac-8ea6-7da2-bac4-ab5751d144be',
            role: 'assistant',
            content:
              'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
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
      {
        namespace: ['tools:f6286351-3cde-5693-05ef-2db7dd706a50'],
        messages: [
          {
            id: 'a87e5aa7-ad53-4908-8888-421747bf1925',
            role: 'user',
            content: 'Research KDEN dispatch.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
          },
          {
            id: 'lc_run--01a12bac-8e75-7cc0-8ace-0a29ca74b6f5',
            role: 'assistant',
            content: '',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'weather-analyst',
            toolCallIds: [
              'a87e5aa7-ad53-4908-8888-421747bf1925-lookup_weather',
            ],
          },
          {
            id: '8ddfe54c-1a71-4b55-b4a4-4b47238ced9c',
            role: 'tool',
            content:
              'KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'lookup_weather',
            toolCallId: 'a87e5aa7-ad53-4908-8888-421747bf1925-lookup_weather',
          },
          {
            id: 'lc_run--01a12bac-8e7b-7c82-aa7e-954b534b8a6e',
            role: 'assistant',
            content:
              'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
            delivery: {
              generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
              phase: 'complete',
              outcome: 'success',
            },
            name: 'weather-analyst',
            toolCallIds: [],
          },
        ],
        values: { files: {} },
        interrupts: [],
      },
    ],
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
    history: [
      {
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
        next: [],
      },
      {
        checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-80c5-66e0-8003-d25c44495dab',
        },
        parent_checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7fbf-67b4-8002-ca27aa03d951',
        },
        created_at: '2026-10-11T15:54:51.475114+00:00',
        next: ['model'],
      },
      {
        checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7fbf-67b4-8002-ca27aa03d951',
        },
        parent_checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7fac-6d94-8001-4ec96ca4e6a8',
        },
        created_at: '2026-10-11T15:54:51.367815+00:00',
        next: ['tools', 'tools', 'tools', 'tools'],
      },
      {
        checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7fac-6d94-8001-4ec96ca4e6a8',
        },
        parent_checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7fab-68e0-8000-bb80f4baf800',
        },
        created_at: '2026-10-11T15:54:51.360189+00:00',
        next: ['model'],
      },
      {
        checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7fab-68e0-8000-bb80f4baf800',
        },
        parent_checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7faa-63be-bfff-73d5a0e3e1dd',
        },
        created_at: '2026-10-11T15:54:51.359660+00:00',
        next: ['PatchToolCallsMiddleware.before_agent'],
      },
      {
        checkpoint: {
          thread_id: '18829a51-4b57-449c-a83c-38b510f6b81e',
          checkpoint_ns: '',
          checkpoint_id: '1f1c58c1-7faa-63be-bfff-73d5a0e3e1dd',
        },
        parent_checkpoint: null,
        created_at: '2026-10-11T15:54:51.359119+00:00',
        next: ['__start__'],
      },
    ],
    values: { files: {} },
    interrupts: [],
    subgraphs: [],
  },
};
it('accepts whole actual native aggregates including children and native history', () => {
  const input = evidence();
  Object.assign(input.snapshot, actualWholeNative.before);
  Object.assign(input.loadedSnapshot, actualWholeNative.loaded);
  expect(captureAuthority(input).kind).toBe('terminal');
});
// Actual second native turn and saved canonical root; earlier raw messages are the fixed baseline.
const followupGrounded = {
  before: {
    status: 'idle',
    messages: [
      {
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf',
        role: 'user',
        content: 'First dispatch.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
        ],
      },
      {
        id: '316ee532-76f3-491e-86f2-5e30a0755ac9',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
      },
      {
        id: 'dd91cf3a-15bd-4f0a-8bb8-218383336d71',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
      },
      {
        id: '89719f15-35db-4361-9856-400d10fbbb36',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
      },
      {
        id: '7dba766a-1b6b-4b0b-bbca-4ff98e4e7131',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
      },
      {
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-final',
        role: 'assistant',
        content:
          'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
      {
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da',
        role: 'user',
        content: 'Second dispatch.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
        ],
      },
      {
        id: 'c1cb085a-e8ca-4e53-a7ee-7df63550c4e8',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
      },
      {
        id: '268e4423-96ef-4587-825d-7f7a1a9dc262',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
      },
      {
        id: 'd841616e-d619-4d6b-80ff-fefc937102a7',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
      },
      {
        id: '194f7d46-d81c-4c21-a592-66d915e321d7',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
      },
      {
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-final',
        role: 'assistant',
        content:
          'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
    ],
    toolCalls: [
      {
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
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
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
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
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
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
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
        name: 'task',
        args: {
          description: 'Research KASE dispatch.',
          subagent_type: 'field-researcher',
        },
        status: 'complete',
        result:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
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
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf',
        role: 'user',
        content: 'First dispatch.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
          '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
        ],
      },
      {
        id: '316ee532-76f3-491e-86f2-5e30a0755ac9',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
      },
      {
        id: 'dd91cf3a-15bd-4f0a-8bb8-218383336d71',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
      },
      {
        id: '89719f15-35db-4361-9856-400d10fbbb36',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
      },
      {
        id: '7dba766a-1b6b-4b0b-bbca-4ff98e4e7131',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
      },
      {
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-final',
        role: 'assistant',
        content:
          'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: '96a9ecbe-f540-41ff-b2a5-44c0b58baca2',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
      {
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da',
        role: 'user',
        content: 'Second dispatch.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
          '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
        ],
      },
      {
        id: 'c1cb085a-e8ca-4e53-a7ee-7df63550c4e8',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
      },
      {
        id: '268e4423-96ef-4587-825d-7f7a1a9dc262',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
      },
      {
        id: 'd841616e-d619-4d6b-80ff-fefc937102a7',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
      },
      {
        id: '194f7d46-d81c-4c21-a592-66d915e321d7',
        role: 'tool',
        content:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
      },
      {
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-final',
        role: 'assistant',
        content:
          'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
        delivery: {
          generation: 'd9728335-d494-4f1c-918c-470804fe9e84',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
    ],
    toolCalls: [
      {
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
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
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
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
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
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
        id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
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
        id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
        name: 'task',
        args: {
          description: 'Research KASE dispatch.',
          subagent_type: 'field-researcher',
        },
        status: 'complete',
        result:
          'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
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
          content: 'First dispatch.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'human',
          name: null,
          id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf',
        },
        {
          content: '',
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-dispatch',
          tool_calls: [
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
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
          id: '316ee532-76f3-491e-86f2-5e30a0755ac9',
          tool_call_id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-0',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: '7dba766a-1b6b-4b0b-bbca-4ff98e4e7131',
          tool_call_id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-3',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: '89719f15-35db-4361-9856-400d10fbbb36',
          tool_call_id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-2',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: 'dd91cf3a-15bd-4f0a-8bb8-218383336d71',
          tool_call_id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-task-1',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: '196e8ca8-c4f4-4fa3-a30e-2340c73b35bf-final',
          tool_calls: [],
          invalid_tool_calls: [],
          usage_metadata: null,
        },
        {
          content: 'Second dispatch.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'human',
          name: null,
          id: '56a53c7b-b734-4de7-b2c2-4e73347130da',
        },
        {
          content: '',
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: '56a53c7b-b734-4de7-b2c2-4e73347130da-dispatch',
          tool_calls: [
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
              type: 'tool_call',
            },
            {
              name: 'task',
              args: {
                description: 'Research KASE dispatch.',
                subagent_type: 'field-researcher',
              },
              id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
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
          id: '268e4423-96ef-4587-825d-7f7a1a9dc262',
          tool_call_id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-1',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: '194f7d46-d81c-4c21-a592-66d915e321d7',
          tool_call_id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-3',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: 'c1cb085a-e8ca-4e53-a7ee-7df63550c4e8',
          tool_call_id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-0',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: 'd841616e-d619-4d6b-80ff-fefc937102a7',
          tool_call_id: '56a53c7b-b734-4de7-b2c2-4e73347130da-task-2',
          artifact: null,
          status: 'success',
        },
        {
          content:
            'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: '56a53c7b-b734-4de7-b2c2-4e73347130da-final',
          tool_calls: [],
          invalid_tool_calls: [],
          usage_metadata: null,
        },
      ],
      files: {},
    },
    next: [],
    checkpoint: {
      thread_id: 'bc91f40b-72f9-4b26-8b99-c4654213ff97',
      checkpoint_ns: '',
      checkpoint_id: '1f1c58c1-91d5-6aac-800a-22660de7d885',
    },
    parent_checkpoint: {
      thread_id: 'bc91f40b-72f9-4b26-8b99-c4654213ff97',
      checkpoint_ns: '',
      checkpoint_id: '1f1c58c1-91cb-6e80-8009-9985ead95340',
    },
    created_at: '2026-10-11T15:54:53.264340+00:00',
    metadata: {
      source: 'loop',
      step: 10,
      parents: {},
      counters_since_delta_snapshot: { messages: [8, 12], files: [2, 12] },
    },
    tasks: [],
  },
};
describe('followup canonical boundaries', () => {
  function followup() {
    const input = evidence(followupGrounded);
    const saved = input.loadedCheckpoint.values.messages;
    const prefix = saved.slice(0, 7);
    const human = saved[7];
    input.turn = captureTurn(captureBaseline({ messages: prefix }), {
      owner: input.owner,
      generation: input.generation,
      threadId: input.threadId,
      humanId: human.id,
      humanContent: human.content,
    });
    return input;
  }
  it('rejects actual followup captured without canonical reload of its prior prefix', () => {
    expect(captureAuthority(followup()).kind).toBe('unconfirmed');
  });
  it('accepts a synthetic canonical-reload variant of the grounded duplicate followup', () => {
    const input = followup();
    for (const s of [input.snapshot, input.loadedSnapshot]) {
      const byId = new Map(s.messages.map((m) => [m.id, m]));
      s.messages.splice(
        0,
        7,
        ...input.loadedCheckpoint.values.messages.slice(0, 7).map((w) => {
          const m = byId.get(w.id);
          if (!m) throw new Error('Fixture missing native message');
          return m;
        })
      );
    }
    expect(captureAuthority(input).kind).toBe('terminal');
  });
  it('rejects prior result reorder even when all three raw sources and native snapshots agree', () => {
    const input = followup();
    for (const r of [
      input.observedState,
      input.loadedCheckpoint,
      input.history[0],
    ])
      [r.values.messages[2], r.values.messages[3]] = [
        r.values.messages[3],
        r.values.messages[2],
      ];
    for (const s of [input.snapshot, input.loadedSnapshot])
      [s.messages[2], s.messages[3]] = [s.messages[3], s.messages[2]];
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('rejects native prior-prefix reorder independently of a valid saved prefix', () => {
    const input = followup();
    [input.snapshot.messages[2], input.snapshot.messages[3]] = [
      input.snapshot.messages[3],
      input.snapshot.messages[2],
    ];
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('rejects changed prior args and literal results in every raw source', () => {
    for (const mutation of ['args', 'result']) {
      const input = followup();
      for (const r of [
        input.observedState,
        input.loadedCheckpoint,
        input.history[0],
      ]) {
        if (mutation === 'args')
          (
            r.values.messages[1].tool_calls?.[0].args as Record<string, unknown>
          ).description = 'changed';
        else r.values.messages[2].content = 'changed';
      }
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
  });
  it('keeps raw root ToolMessage error status separate from native complete delivery', () => {
    const result = captureAuthority(evidence(rootError));
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal')
      expect(Object.values(result.rawToolStatuses)).toEqual(['error']);
  });
  it('does not evaluate getters in raw authority', () => {
    let reads = 0;
    const input = evidence();
    Object.defineProperty(input.loadedCheckpoint, 'values', {
      get() {
        reads++;
        return {};
      },
      enumerable: true,
    });
    expect(captureAuthority(input).kind).toBe('unconfirmed');
    expect(reads).toBe(0);
  });
  it('rejects extra humans, duplicate raw IDs, nonterminal tasks and native interrupted delivery', () => {
    const a = evidence();
    a.loadedCheckpoint.values.messages[2].id =
      a.loadedCheckpoint.values.messages[0].id;
    expect(captureAuthority(a).kind).toBe('unconfirmed');
    const b = evidence();
    b.snapshot.messages[0].delivery.outcome = 'interrupted';
    expect(captureAuthority(b).kind).toBe('unconfirmed');
    const c = evidence();
    (c.loadedCheckpoint.tasks as unknown[]).push({ id: 'pending' });
    expect(captureAuthority(c).kind).toBe('unconfirmed');
  });
});
// Grounded selected payloads from Task1 unchanged pinned Deep Agents/native SDK run.
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
const rootError = {
  before: {
    status: 'idle',
    messages: [
      {
        id: 'e2bf0109-d910-499c-b861-838aa540e081',
        role: 'user',
        content: 'Invalid root task arguments.',
        delivery: {
          generation: '9a54cd7e-67aa-4b33-8166-eba8b89d1e33',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'e2bf0109-d910-499c-b861-838aa540e081-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: '9a54cd7e-67aa-4b33-8166-eba8b89d1e33',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: ['e2bf0109-d910-499c-b861-838aa540e081-invalid-task'],
      },
      {
        id: 'c9b1b13a-98a6-4ebe-8cc3-8f501a964acc',
        role: 'tool',
        content:
          "Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
        delivery: {
          generation: '9a54cd7e-67aa-4b33-8166-eba8b89d1e33',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: 'e2bf0109-d910-499c-b861-838aa540e081-invalid-task',
      },
      {
        id: 'e2bf0109-d910-499c-b861-838aa540e081-final',
        role: 'assistant',
        content:
          "Dispatch assessment: Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
        delivery: {
          generation: '9a54cd7e-67aa-4b33-8166-eba8b89d1e33',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
    ],
    toolCalls: [
      {
        id: 'e2bf0109-d910-499c-b861-838aa540e081-invalid-task',
        name: 'task',
        args: { subagent_type: 'field-researcher' },
        status: 'complete',
        result:
          "Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
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
        id: 'e2bf0109-d910-499c-b861-838aa540e081',
        role: 'user',
        content: 'Invalid root task arguments.',
        delivery: {
          generation: 'e2bf0109-d910-499c-b861-838aa540e081',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'e2bf0109-d910-499c-b861-838aa540e081-dispatch',
        role: 'assistant',
        content: '',
        delivery: {
          generation: 'e2bf0109-d910-499c-b861-838aa540e081-dispatch',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: ['e2bf0109-d910-499c-b861-838aa540e081-invalid-task'],
      },
      {
        id: 'c9b1b13a-98a6-4ebe-8cc3-8f501a964acc',
        role: 'tool',
        content:
          "Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
        delivery: {
          generation: 'c9b1b13a-98a6-4ebe-8cc3-8f501a964acc',
          phase: 'complete',
          outcome: 'success',
        },
        name: 'task',
        toolCallId: 'e2bf0109-d910-499c-b861-838aa540e081-invalid-task',
      },
      {
        id: 'e2bf0109-d910-499c-b861-838aa540e081-final',
        role: 'assistant',
        content:
          "Dispatch assessment: Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
        delivery: {
          generation: 'e2bf0109-d910-499c-b861-838aa540e081-final',
          phase: 'complete',
          outcome: 'success',
        },
        toolCallIds: [],
      },
    ],
    toolCalls: [
      {
        id: 'e2bf0109-d910-499c-b861-838aa540e081-invalid-task',
        name: 'task',
        args: { subagent_type: 'field-researcher' },
        status: 'complete',
        result:
          "Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
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
          content: 'Invalid root task arguments.',
          additional_kwargs: {},
          response_metadata: {},
          type: 'human',
          name: null,
          id: 'e2bf0109-d910-499c-b861-838aa540e081',
        },
        {
          content: '',
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: 'e2bf0109-d910-499c-b861-838aa540e081-dispatch',
          tool_calls: [
            {
              name: 'task',
              args: { subagent_type: 'field-researcher' },
              id: 'e2bf0109-d910-499c-b861-838aa540e081-invalid-task',
              type: 'tool_call',
            },
          ],
          invalid_tool_calls: [],
          usage_metadata: null,
        },
        {
          content:
            "Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
          additional_kwargs: {},
          response_metadata: {},
          type: 'tool',
          name: 'task',
          id: 'c9b1b13a-98a6-4ebe-8cc3-8f501a964acc',
          tool_call_id: 'e2bf0109-d910-499c-b861-838aa540e081-invalid-task',
          artifact: null,
          status: 'error',
        },
        {
          content:
            "Dispatch assessment: Error invoking tool 'task' with kwargs {'subagent_type': 'field-researcher'} with error:\n description: Field required\n Please fix the error and try again.",
          additional_kwargs: {},
          response_metadata: {},
          type: 'ai',
          name: null,
          id: 'e2bf0109-d910-499c-b861-838aa540e081-final',
          tool_calls: [],
          invalid_tool_calls: [],
          usage_metadata: null,
        },
      ],
      files: {},
    },
    next: [],
    checkpoint: {
      thread_id: '2d0613e3-29a4-451b-8498-71d377d9b437',
      checkpoint_ns: '',
      checkpoint_id: '1f1c58c1-a047-675c-8004-a7c9a009ea06',
    },
    parent_checkpoint: {
      thread_id: '2d0613e3-29a4-451b-8498-71d377d9b437',
      checkpoint_ns: '',
      checkpoint_id: '1f1c58c1-a040-6c22-8003-4a2ac5f525c1',
    },
    created_at: '2026-10-11T15:54:54.778961+00:00',
    metadata: {
      source: 'loop',
      step: 4,
      parents: {},
      counters_since_delta_snapshot: { messages: [4, 6], files: [0, 6] },
    },
    tasks: [],
  },
};
const clone = <T>(value: T): T => structuredClone(value);
function evidence(f: typeof grounded | typeof rootError = grounded) {
  const saved = { ...clone(f.saved), next: clone(f.saved.next) as string[] };
  const human = saved.values.messages[0];
  return {
    owner: 'view',
    generation: 'operation',
    threadId: saved.checkpoint.thread_id,
    outcome: 'success',
    turn: captureTurn(captureBaseline(), {
      owner: 'view',
      generation: 'operation',
      threadId: saved.checkpoint.thread_id,
      humanId: human.id,
      humanContent: human.content,
    }),
    observedState: clone(saved),
    history: [clone(saved)],
    loadedCheckpoint: clone(saved),
    snapshot: clone(f.before) as typeof grounded.before,
    loadedSnapshot: clone(f.loaded) as typeof grounded.loaded,
  };
}
describe('bounded data capture', () => {
  it('captures before literal serialization without evaluating getters', () => {
    let reads = 0;
    const value = {
      get text() {
        reads++;
        return 'bad';
      },
    };
    expect(() => literal(value)).toThrow();
    expect(reads).toBe(0);
  });
  it('bounds encoded control characters and preserves exact literal JSON', () => {
    expect(() =>
      literal({ text: '\u0000'.repeat(LIMITS.fieldText) })
    ).toThrow();
    const value = {
      quote: '"\\😀\ud800',
      array: [undefined, 0, null],
      optional: undefined,
    };
    expect(literal(value)).toBe(JSON.stringify(value, null, 2));
  });
  it('accepts exact depth and node boundaries before rejecting overflow', () => {
    let v: unknown = 0;
    for (let i = 0; i < 32; i++) v = { v };
    expect(() => copyData(v)).not.toThrow();
    expect(() => copyData(new Array(LIMITS.nodes - 1).fill(0))).not.toThrow();
    expect(() => copyData(new Array(4294967295))).toThrow();
  });
  it('owns optional undefined native fields but rejects them in JSON', () => {
    expect(copyData({ a: undefined })).toEqual({ a: undefined });
    expect(() => copyData({ a: undefined }, false)).toThrow();
  });
  it('rejects getters without running them', () => {
    let reads = 0;
    const value = {
      get bad() {
        reads++;
        return 'bad';
      },
    };
    expect(() => copyData(value)).toThrow();
    expect(reads).toBe(0);
  });
  it.each([
    new Date(),
    Object.assign([], { x: 1 }),
    Object.assign(new Array(2), { 1: 1 }),
    { [Symbol('x')]: 1 },
  ])('rejects nonplain or sparse data', (value) =>
    expect(() => copyData(value)).toThrow()
  );
  it('rejects cycles', () => {
    const value: unknown[] = [];
    value.push(value);
    expect(() => copyData(value)).toThrow();
  });
  it('bounds depth and nodes before recursive copy', () => {
    let value: unknown = 0;
    for (let i = 0; i < 33; i++) value = { value };
    expect(() => copyData(value)).toThrow();
    expect(() => copyData(new Array(10001).fill(0))).toThrow();
  });
  it('bounds text including keys in UTF16 units', () => {
    expect(copyData('😀'.repeat(LIMITS.copyText / 2))).toBe(
      '😀'.repeat(LIMITS.copyText / 2)
    );
    expect(() => copyData('😀'.repeat(LIMITS.copyText / 2) + 'x')).toThrow();
    expect(() => copyData({ ['x'.repeat(LIMITS.copyText)]: 'x' })).toThrow();
  });
});
describe('actual saved root authority', () => {
  it('rejects malformed hand-built owner identity even when both inputs agree', () => {
    const input = evidence();
    if (!input.turn) throw new Error('Fixture missing turn');
    input.owner = 123 as unknown as string;
    input.turn = { ...input.turn, owner: input.owner };
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('accepts actual current result permutation and independently loaded native root', () => {
    const input = evidence();
    const result = captureAuthority(input);
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal')
      expect(result.messages).toEqual(input.loadedCheckpoint.values.messages);
  });
  it('accepts actual resolved raw ToolMessage error with missing task description', () => {
    expect(captureAuthority(evidence(rootError)).kind).toBe('terminal');
  });
  it.each(['owner', 'generation', 'threadId'])('rejects stale %s', (key) => {
    const input = evidence();
    (input as Record<string, unknown>)[key] = 'foreign';
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it.each(['error', 'aborted', 'interrupted', 'paused'])(
    'requires native success %s',
    (outcome) => {
      const input = evidence();
      input.outcome = outcome;
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
  );
  it.each(['observedState', 'loadedCheckpoint', 'history'])(
    'requires independent identical raw evidence %s',
    (key) => {
      const input = evidence();
      if (key === 'history')
        input.history[0].values.messages[0].content = 'changed';
      else
        input[
          key as 'observedState' | 'loadedCheckpoint'
        ].values.messages[0].content = 'changed';
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
  );
  it('rejects duplicate checkpoint IDs, foreign namespaces and nonterminal raw controls', () => {
    const a = evidence();
    a.history.push(clone(a.history[0]));
    expect(captureAuthority(a).kind).toBe('unconfirmed');
    const b = evidence();
    b.loadedCheckpoint.checkpoint.checkpoint_ns = 'child';
    expect(captureAuthority(b).kind).toBe('unconfirmed');
    const c = evidence();
    c.observedState.next.push('running');
    expect(captureAuthority(c).kind).toBe('unconfirmed');
  });
  it.each(['snapshot', 'loadedSnapshot'])(
    'rejects native content, args, IDs or declaration changes in %s',
    (key) => {
      for (const mutation of ['content', 'args', 'id', 'calls']) {
        const input = evidence();
        const s = input[key as 'snapshot' | 'loadedSnapshot'];
        if (mutation === 'content') s.messages[2].content += 'changed';
        if (mutation === 'id') s.messages[2].id = 'synthetic';
        if (mutation === 'args') s.toolCalls[0].args.description = 'changed';
        if (mutation === 'calls') s.messages[1].toolCallIds?.reverse();
        expect(captureAuthority(input).kind).toBe('unconfirmed');
      }
    }
  );
  it('rejects moved results across assistant batches and incomplete ownership', () => {
    const input = evidence();
    [input.snapshot.messages[1], input.snapshot.messages[2]] = [
      input.snapshot.messages[2],
      input.snapshot.messages[1],
    ];
    expect(captureAuthority(input).kind).toBe('unconfirmed');
    const b = evidence();
    b.snapshot.toolCalls.pop();
    expect(captureAuthority(b).kind).toBe('unconfirmed');
  });
  it('requires strict previously confirmed canonical raw prefix', () => {
    const input = evidence();
    const old = clone(input.loadedCheckpoint.values.messages);
    input.turn = captureTurn(captureBaseline({ messages: old }), {
      owner: 'view',
      generation: 'operation',
      threadId: input.threadId,
      humanId: 'followup',
      humanContent: 'Next',
    });
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('does not accept synthetic-only or missing human IDs', () => {
    const input = evidence();
    input.turn = captureTurn(captureBaseline(), {
      owner: 'view',
      generation: 'operation',
      threadId: input.threadId,
      humanId: 'history-message-0',
      humanContent: 'Dispatch request.',
    });
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
});
