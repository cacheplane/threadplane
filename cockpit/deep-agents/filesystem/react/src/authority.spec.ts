import { describe, expect, it } from 'vitest';
import {
  captureAuthority,
  captureBaseline,
  captureResume,
  captureTurn,
  sameObservedAuthority,
} from './authority';

const identity = {
  owner: 'owner',
  generation: 'attempt',
  threadId: 'thread',
  humanId: 'human',
  humanContent: 'Assess airport',
};
const cp = { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: 'cp' };
const proposal = {
  name: 'write_file',
  args: { file_path: '/reports/report', content: 'future' },
  description: 'Review',
};
const pause = {
  id: 'interrupt',
  value: {
    action_requests: [proposal],
    review_configs: [
      {
        action_name: 'write_file',
        allowed_decisions: ['approve', 'edit', 'reject', 'respond'],
      },
    ],
  },
};
// Synthetic unit messages grounded in the pinned native wire shapes. Integration
// of actual graph output and createSession belongs to Task3, not this fixture.
function example(paused = true, rejected = false): any {
  const calls = [
    { id: 'call', name: proposal.name, args: proposal.args, type: 'tool_call' },
  ];
  const messages: any[] = [
    { id: 'human', type: 'human', name: null, content: identity.humanContent },
    {
      id: 'ai',
      type: 'ai',
      name: null,
      content: '',
      tool_calls: calls,
      invalid_tool_calls: [],
    },
    ...(!paused
      ? [
          {
            id: 'result',
            type: 'tool',
            name: proposal.name,
            content: rejected ? 'User rejected' : 'Updated file',
            tool_call_id: 'call',
            status: rejected ? 'error' : 'success',
          },
          {
            id: 'answer',
            type: 'ai',
            name: null,
            content: 'Assessment ready',
            tool_calls: [],
            invalid_tool_calls: [],
          },
        ]
      : []),
  ];
  const files = { '/old': { content: 'saved', encoding: 'utf-8' } };
  const values = { messages, files };
  const next = paused ? ['HumanInTheLoopMiddleware.after_model'] : [];
  return {
    ...identity,
    turn: captureTurn(captureBaseline({ messages: [], files: {} }), identity),
    outcome: paused ? 'paused' : 'success',
    observedCheckpoint: cp,
    observedValues: paused ? { ...values, __interrupt__: [pause] } : values,
    loadedCheckpoint: {
      checkpoint: cp,
      values,
      next,
      tasks: paused ? [{ id: 'task', name: next[0], interrupts: [pause] }] : [],
    },
    snapshot: {
      status: 'idle',
      interrupts: paused ? [pause] : [],
      subgraphs: [],
      values: { files },
      history: [{ checkpoint: cp, next }],
      messages: messages.map((m) => ({
        id: m.id,
        role:
          m.type === 'human' ? 'user' : m.type === 'ai' ? 'assistant' : 'tool',
        content: m.content,
        delivery: {
          phase: 'complete',
          generation: m.id,
          outcome: paused && m.id === 'ai' ? 'paused' : 'success',
        },
        ...(m.name ? { name: m.name } : {}),
        ...(m.tool_calls
          ? { toolCallIds: m.tool_calls.map((c: any) => c.id) }
          : {}),
        ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
      })),
      toolCalls: calls.map((c) => ({
        id: c.id,
        name: c.name,
        args: c.args,
        status: paused ? 'pending' : 'complete',
        ...(!paused
          ? { result: rejected ? 'User rejected' : 'Updated file' }
          : {}),
      })),
    },
  };
}
describe('exact native checkpoint authority', () => {
  it('confirms saved files on native pause without predicting the proposed report', () => {
    const input = example();
    const result = captureAuthority(input);
    expect(result.kind).toBe('paused');
    if (result.kind !== 'paused') throw new Error('Expected paused authority');
    expect(result.workspace.files.map((f: any) => f.path)).toEqual(['/old']);
    expect(result.approval.actions[0].args.content).toBe('future');
    expect(sameObservedAuthority(result, input)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('confirms native terminal and legitimate rejected tool results from actual saved files', () => {
    for (const rejected of [false, true]) {
      const input = example(false, rejected);
      expect(captureAuthority(input).kind).toBe('terminal');
      input.loadedCheckpoint.values.files = {};
      input.observedValues = input.loadedCheckpoint.values;
      input.snapshot.values = { files: {} };
      const empty = captureAuthority(input);
      if (empty.kind !== 'terminal')
        throw new Error('Expected terminal authority');
      expect(empty.workspace.files).toEqual([]);
    }
  });
  it.each(['failed', 'cancelled', 'success'])(
    'cannot obtain pause authority from %s outcome',
    (outcome) => {
      const input = example();
      input.outcome = outcome;
      expect(captureAuthority(input)).toEqual({ kind: 'unconfirmed' });
    }
  );
  it('requires observed values, exact latest history head, raw tasks and owned root checkpoint', () => {
    const changes: ((i: any) => void)[] = [
      (i) => {
        i.owner = 'other';
      },
      (i) => {
        i.generation = 'old';
      },
      (i) => {
        i.threadId = 'other';
      },
      (i) => {
        i.snapshot.status = 'running';
      },
      (i) => {
        i.snapshot.error = 'error';
      },
      (i) => {
        i.snapshot.subgraphs = [{}];
      },
      (i) => {
        i.observedCheckpoint = { ...cp, checkpoint_ns: 'foreign' };
      },
      (i) => {
        i.observedCheckpoint = { ...cp, checkpoint_map: {} };
      },
      (i) => {
        i.observedCheckpoint = {
          ...cp,
          checkpoint_map: { '': 'cp', child: 'foreign' },
        };
      },
      (i) => {
        i.snapshot.history = [
          {
            checkpoint: { ...cp, checkpoint_id: 'old' },
            next: i.loadedCheckpoint.next,
          },
        ];
      },
      (i) => {
        i.loadedCheckpoint.tasks = [];
      },
      (i) => {
        i.observedValues = { ...i.observedValues, files: {} };
      },
      (i) => {
        i.snapshot.values = { files: {} };
      },
      (i) => {
        i.loadedCheckpoint.values.files = null;
      },
      (i) => {
        i.snapshot.interrupts = [];
      },
      (i) => {
        i.loadedCheckpoint.tasks[0].interrupts.push(pause);
      },
    ];
    for (const change of changes) {
      const input = example();
      change(input);
      expect(captureAuthority(input)).toEqual({ kind: 'unconfirmed' });
    }
  });
  it('checks current human, canonical prefix, ids, arguments, result content and delivery', () => {
    const changes: ((i: any) => void)[] = [
      (i) => {
        i.turn = captureTurn(
          captureBaseline({
            messages: [{ id: 'old', type: 'human', content: 'old' }],
            files: {},
          }),
          identity
        );
      },
      (i) => {
        i.loadedCheckpoint.values.messages[0].content = 'old';
      },
      (i) => {
        i.loadedCheckpoint.values.messages[1].id = 'human';
      },
      (i) => {
        i.snapshot.messages[1].delivery.outcome = 'success';
      },
      (i) => {
        i.snapshot.messages[1].delivery.generation = 'other';
      },
      (i) => {
        i.snapshot.toolCalls[0].args = {
          file_path: '/different',
          content: 'future',
        };
      },
      (i) => {
        i.snapshot.toolCalls.push(i.snapshot.toolCalls[0]);
      },
      (i) => {
        i.loadedCheckpoint.values.messages[1].invalid_tool_calls = [{}];
      },
    ];
    for (const change of changes) {
      const input = example();
      change(input);
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
    const terminal = example(false);
    terminal.snapshot.toolCalls[0].result = 'predicted';
    expect(captureAuthority(terminal).kind).toBe('unconfirmed');
    const unfinished = example(false);
    unfinished.loadedCheckpoint.values.messages.pop();
    unfinished.snapshot.messages.pop();
    expect(captureAuthority(unfinished).kind).toBe('unconfirmed');
  });
  it('captures resume using the original human and prefix with a new local generation', () => {
    const original = example().turn;
    const resumed = captureResume(original, 'resume-attempt');
    expect(resumed).toEqual({ ...original, generation: 'resume-attempt' });
    const input = example();
    input.turn = resumed;
    input.generation = 'resume-attempt';
    const authority = captureAuthority(input);
    expect(authority.kind).toBe('paused');
    input.generation = 'attempt';
    expect(sameObservedAuthority(authority, input)).toBe(false);
    expect(
      captureTurn(
        captureBaseline({
          messages: [{ id: 'human', type: 'human', content: 'old' }],
          files: {},
        }),
        identity
      )
    ).toBeUndefined();
  });
  it('invalidates captured pause on changed checkpoint or current batch', () => {
    const input = example();
    const saved = captureAuthority(input);
    const changed = example();
    changed.snapshot.interrupts[0] = { ...pause, id: 'different' };
    expect(sameObservedAuthority(saved, changed)).toBe(false);
    changed.observedCheckpoint = { ...cp, checkpoint_id: 'new' };
    expect(sameObservedAuthority(saved, changed)).toBe(false);
  });
  it('correlates protected subset in mixed pending notes, report and legitimate read calls', () => {
    const input = example();
    const extras = [
      {
        id: 'note',
        name: 'write_file',
        args: { file_path: '/notes/note', content: 'note' },
        type: 'tool_call',
      },
      {
        id: 'read',
        name: 'read_file',
        args: { file_path: '/notes/old' },
        type: 'tool_call',
      },
      {
        id: 'airport',
        name: 'lookup_field_elevation',
        args: { airport: 'KASE' },
        type: 'tool_call',
      },
    ];
    input.loadedCheckpoint.values.messages[1].tool_calls.unshift(...extras);
    input.snapshot.messages[1].toolCallIds.unshift(...extras.map((c) => c.id));
    input.snapshot.toolCalls.unshift(
      ...extras.map((c) => ({
        id: c.id,
        name: c.name,
        args: c.args,
        status: 'pending',
      }))
    );
    expect(captureAuthority(input).kind).toBe('paused');
    // A second protected call is not allowed to disappear from the interrupt.
    const extra = {
      id: 'hidden',
      name: 'delete',
      args: { file_path: '/reports' },
      type: 'tool_call',
    };
    input.loadedCheckpoint.values.messages[1].tool_calls.push(extra);
    input.snapshot.messages[1].toolCallIds.push(extra.id);
    input.snapshot.toolCalls.push({ ...extra, status: 'pending' });
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('accepts duplicate target actions in their complete canonical order', () => {
    const input = example();
    const second = {
      id: 'second',
      name: 'edit_file',
      args: {
        file_path: '/reports/report',
        old_string: 'future',
        new_string: 'edited',
      },
      type: 'tool_call',
    };
    input.loadedCheckpoint.values.messages[1].tool_calls.push(second);
    input.snapshot.messages[1].toolCallIds.push(second.id);
    input.snapshot.toolCalls.push({ ...second, status: 'pending' });
    const batch = {
      ...pause,
      value: {
        action_requests: [
          proposal,
          { name: second.name, args: second.args, description: 'Edit' },
        ],
        review_configs: [
          pause.value.review_configs[0],
          {
            action_name: second.name,
            allowed_decisions: ['approve', 'reject'],
          },
        ],
      },
    };
    input.snapshot.interrupts = [batch];
    input.loadedCheckpoint.tasks[0].interrupts = [batch];
    input.observedValues.__interrupt__ = [batch];
    expect(captureAuthority(input).kind).toBe('paused');
    batch.value.action_requests.reverse();
    batch.value.review_configs.reverse();
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('requires successful native terminal outcome and raw resolved tool flow', () => {
    for (const outcome of ['failed', 'cancelled', 'paused']) {
      const input = example(false);
      input.outcome = outcome;
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
    const input = example(false, true);
    input.loadedCheckpoint.values.messages[2].tool_call_id = 'unknown';
    input.snapshot.messages[2].toolCallId = 'unknown';
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('recognizes root recursive delete as protected without treating an exact /reports write as protected', () => {
    const input = example();
    const deletion = {
      id: 'root-delete',
      name: 'delete',
      args: { file_path: '/' },
      type: 'tool_call',
    };
    input.loadedCheckpoint.values.messages[1].tool_calls = [deletion];
    input.snapshot.messages[1].toolCallIds = [deletion.id];
    input.snapshot.toolCalls = [{ ...deletion, status: 'pending' }];
    const batch = {
      id: 'root-pause',
      value: {
        action_requests: [
          {
            name: 'delete',
            args: deletion.args,
            description: 'Delete root subtree',
          },
        ],
        review_configs: [
          { action_name: 'delete', allowed_decisions: ['approve', 'reject'] },
        ],
      },
    };
    input.snapshot.interrupts = [batch];
    input.loadedCheckpoint.tasks[0].interrupts = [batch];
    input.observedValues.__interrupt__ = [batch];
    expect(captureAuthority(input).kind).toBe('paused');
  });
  it('accepts read-only unchanged saved files and supplies only immutable actual messages for the next baseline', () => {
    const input = example(false);
    input.loadedCheckpoint.values.messages.splice(1, 2);
    input.snapshot.messages.splice(1, 2);
    input.snapshot.toolCalls = [];
    const result = captureAuthority(input);
    expect(result.kind).toBe('terminal');
    if (result.kind !== 'terminal') throw new Error('Expected terminal');
    expect(result.workspace.files).toEqual([
      { path: '/old', kind: 'text', content: 'saved' },
    ]);
    expect(Object.isFrozen(result.messages)).toBe(true);
    expect(captureBaseline({ messages: result.messages })).toEqual({
      messages: input.loadedCheckpoint.values.messages,
    });
    expect(result).not.toHaveProperty('values');
  });
  it('rejects foreign nested task state even when native subgraphs are empty', () => {
    const input = example();
    input.loadedCheckpoint.tasks[0].state = {
      checkpoint: { ...cp, checkpoint_ns: 'child', checkpoint_id: 'foreign' },
    };
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('confirms valid legacy checkpoints through raw, observed, native and optional history parity', () => {
    const files = {
      '/a': { content: Array(65536).fill('') },
      '/b': { content: Array(65536).fill('') },
    };
    for (const paused of [true, false]) {
      const input = example(paused);
      input.loadedCheckpoint.values.files = files;
      input.observedValues.files = files;
      input.snapshot.values = { files };
      input.snapshot.history[0].values = input.loadedCheckpoint.values;
      const result = captureAuthority(input);
      expect(result.kind).toBe(paused ? 'paused' : 'terminal');
      if (result.kind === 'unconfirmed')
        throw new Error('Expected confirmed legacy checkpoint');
      expect(result.workspace.files).toHaveLength(2);
      expect(captureBaseline(input.loadedCheckpoint.values)?.messages).toEqual(
        result.messages
      );
    }
  });
  it('keeps oversized non-file canonical checkpoint evidence unconfirmed', () => {
    const input = example();
    input.loadedCheckpoint.metadata = { arbitrary: Array(100001).fill('') };
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
});
