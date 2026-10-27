import { projectMemory } from './memory-projection';
import { describe, it, expect } from 'vitest';
import {
  captureAuthority,
  captureBaseline,
  captureTurn,
  copyData,
} from './authority';
// Synthetic unit fixture for adversarial contract checks; not a store/native proof.
function authorityInput(
  status = 'success',
  args: unknown = { file_path: '/skills/runway-analysis/SKILL.md' },
  result = '1  instruction'
) {
  const messages = [
    { id: 'human', type: 'human', content: 'Inspect runway.' },
    {
      id: 'call-message',
      type: 'ai',
      content: '',
      tool_calls: [{ id: 'read', name: 'read_file', args, type: 'tool_call' }],
    },
    {
      id: 'result',
      type: 'tool',
      content: result,
      name: 'read_file',
      tool_call_id: 'read',
      status,
    },
    { id: 'final', type: 'ai', content: 'Assessment.', tool_calls: [] },
  ];
  const values = {
    messages,
    memory_contents: { '/memories/AGENTS.md': 'Literal\n\nMemory' },
    memory_scope_owner: '11111111-1111-4111-8111-111111111111',
    files: {},
  };
  const state = {
    values,
    next: [],
    tasks: [],
    checkpoint: {
      thread_id: 'thread',
      checkpoint_ns: '',
      checkpoint_id: 'checkpoint',
    },
  };
  const delivery = {
    generation: 'sdk-generation',
    phase: 'complete',
    outcome: 'success',
  };
  const snapshot = {
    status: 'idle',
    messages: [
      { id: 'human', role: 'user', content: 'Inspect runway.', delivery },
      {
        id: 'call-message',
        role: 'assistant',
        content: '',
        toolCallIds: ['read'],
        delivery,
      },
      {
        id: 'result',
        role: 'tool',
        content: result,
        name: 'read_file',
        toolCallId: 'read',
        delivery,
      },
      {
        id: 'final',
        role: 'assistant',
        content: 'Assessment.',
        toolCallIds: [],
        delivery,
      },
    ],
    toolCalls: [
      { id: 'read', name: 'read_file', args, status: 'complete', result },
    ],
    values: {
      memory_contents: values.memory_contents,
      memory_scope_owner: values.memory_scope_owner,
      files: {},
    },
    interrupts: [],
    subgraphs: [],
  };
  const turn = captureTurn(captureBaseline(), {
    memoryScope: '11111111-1111-4111-8111-111111111111',
    owner: 'app-owner',
    generation: 'generation',
    threadId: 'thread',
    humanId: 'human',
    humanContent: 'Inspect runway.',
  });
  return {
    turn,
    memoryScope: '11111111-1111-4111-8111-111111111111',
    owner: 'app-owner',
    generation: 'generation',
    threadId: 'thread',
    outcome: 'success',
    observedState: state,
    history: [structuredClone(state)],
    loadedCheckpoint: structuredClone(state),
    snapshot,
    loadedSnapshot: structuredClone(snapshot),
  };
}

describe('terminal owned Memory authority', () => {
  function withPrivateMemory() {
    const input = authorityInput();
    for (const values of [
      input.observedState.values,
      input.history[0].values,
      input.loadedCheckpoint.values,
      input.snapshot.values,
      input.loadedSnapshot.values,
    ]) {
      (values as any).memory_scope_owner =
        '11111111-1111-4111-8111-111111111111';
    }
    return input;
  }
  it.each([
    { keys: [] },
    { keys: ['memory_contents'] },
    { keys: ['memory_scope_owner'] },
    { keys: ['memory_contents', 'memory_scope_owner'] },
  ])(
    'confirms only absent live private keys $keys and retains exact checkpoint metadata',
    ({ keys }) => {
      const input = withPrivateMemory();
      for (const key of keys) delete (input.snapshot.values as any)[key];
      const authority = captureAuthority(input);
      expect(authority.kind).toBe('terminal');
      if (authority.kind !== 'terminal')
        throw Error('Unconfirmed private projection');
      expect(authority.values).toEqual(input.loadedCheckpoint.values);
      expect(authority.rawToolStatuses).toEqual({ read: 'success' });
    }
  );
  it.each(['memory_contents', 'memory_scope_owner'])(
    'rejects conflicting or present undefined private %s',
    (key) => {
      for (const value of [[], undefined]) {
        const input = withPrivateMemory();
        delete (input.snapshot.values as any)[
          key === 'memory_contents' ? 'memory_scope_owner' : 'memory_contents'
        ];
        (input.snapshot.values as any)[key] = value;
        expect(captureAuthority(input).kind).toBe('unconfirmed');
      }
    }
  );
  it.each(['memory_contents', 'memory_scope_owner'])(
    'requires loaded private %s even when live omits both',
    (key) => {
      for (const remove of [true, false]) {
        const input = withPrivateMemory();
        delete (input.snapshot.values as any).memory_contents;
        delete (input.snapshot.values as any).memory_scope_owner;
        if (remove) delete (input.loadedSnapshot.values as any)[key];
        else (input.loadedSnapshot.values as any)[key] = [];
        expect(captureAuthority(input).kind).toBe('unconfirmed');
      }
    }
  );
  it('rejects missing/conflicting ordinary keys, nested omissions, unknown extras and nonrecord live values', () => {
    for (const modify of [
      (i: any) => {
        delete i.snapshot.values.files;
      },
      (i: any) => {
        i.snapshot.values.files = { stale: true };
      },
      (i: any) => {
        i.snapshot.values.extra = [];
      },
      (i: any) => {
        i.snapshot.values = structuredClone(i.snapshot.values);
        delete i.snapshot.values.memory_contents['/memories/AGENTS.md'];
      },
      ...[undefined, null, [], 'invalid'].map((value) => (i: any) => {
        i.snapshot.values = value;
      }),
    ]) {
      const input = authorityInput();
      modify(input);
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
  });
  it('does not accept custom contents as persistence when the checkpoint lacks them', () => {
    const input = authorityInput();
    for (const values of [
      input.observedState.values,
      input.history[0].values,
      input.loadedCheckpoint.values,
      input.loadedSnapshot.values,
    ])
      delete (values as any).memory_contents;
    expect(captureAuthority(input).kind).toBe('unconfirmed');
    delete (input.snapshot.values as any).memory_contents;
    (input.snapshot as any).customEvents = [
      { name: 'skills_visibility', data: { memory_contents: ['untrusted'] } },
    ];
    const authority = captureAuthority(input);
    expect(authority.kind).toBe('terminal');
    if (authority.kind !== 'terminal')
      throw Error('Unconfirmed ordinary values');
    expect(Object.hasOwn(authority.values, 'memory_contents')).toBe(false);
  });
  it('keeps transcript, tool, control and ownership gates when live private keys are omitted', () => {
    for (const modify of [
      (i: any) => {
        i.snapshot.messages[3].content = 'Different answer';
      },
      (i: any) => {
        i.snapshot.toolCalls[0].result = 'Different result';
      },
      (i: any) => {
        i.snapshot.interrupts = [{ id: 'interrupt' }];
      },
      (i: any) => {
        i.owner = 'other-owner';
      },
      (i: any) => {
        i.observedState.next.push('pending');
      },
    ]) {
      const input = authorityInput();
      delete (input.snapshot.values as any).memory_contents;
      modify(input);
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
  });
  it('confirms current/fresh-history/exact/native-load equality and retains raw success/error', () => {
    expect(captureAuthority(authorityInput())).toMatchObject({
      kind: 'terminal',
      rawToolStatuses: { read: 'success' },
    });
    expect(captureAuthority(authorityInput('error'))).toMatchObject({
      kind: 'terminal',
      rawToolStatuses: { read: 'error' },
    });
  });
  it.each(['generation', 'threadId', 'outcome'])(
    'rejects mismatched %s',
    (key) => {
      const input = authorityInput();
      (input as any)[key] = 'wrong';
      expect(captureAuthority(input).kind).toBe('unconfirmed');
    }
  );
  it.each([
    'observedState',
    'history',
    'loadedCheckpoint',
    'snapshot',
    'loadedSnapshot',
  ])('rejects contradictory %s', (key) => {
    const input = authorityInput();
    const target = key === 'history' ? input.history[0] : (input as any)[key];
    target.values.memory_contents = [];
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
  it('requires actual raw status and exact tool arguments/results/ids', () => {
    expect(captureAuthority(authorityInput('unknown')).kind).toBe(
      'unconfirmed'
    );
    for (const modify of [
      (i: any) =>
        (i.snapshot.toolCalls[0].args.file_path = '/skills/other/SKILL.md'),
      (i: any) => (i.snapshot.toolCalls[0].result = 'false'),
      (i: any) => i.snapshot.toolCalls.push(i.snapshot.toolCalls[0]),
      (i: any) => i.loadedCheckpoint.tasks.push({ id: 'pending' }),
      (i: any) => i.loadedCheckpoint.next.push('tools'),
    ]) {
      const i = authorityInput();
      modify(i);
      expect(captureAuthority(i).kind).toBe('unconfirmed');
    }
  });
  it('owns bounded plain data and rejects symbols, cycles, sparse arrays and hidden accessors', () => {
    const cycle: any = {};
    cycle.self = cycle;
    for (const value of [
      cycle,
      Array(2),
      new Date(),
      { [Symbol('x')]: 1 },
      Object.defineProperty({}, 'x', { get: () => 1 }),
    ])
      expect(() => copyData(value)).toThrow();
  });
  it('confirms a followup only against its full prior human/tool transcript', () => {
    const previous = authorityInput();
    const prior = previous.loadedCheckpoint.values.messages;
    const input = authorityInput();
    const continuation = [
      { id: 'second-human', type: 'human', content: 'Follow up.' },
      {
        id: 'second-final',
        type: 'ai',
        content: 'Followup answer.',
        tool_calls: [],
      },
    ];
    const state = {
      ...input.loadedCheckpoint,
      values: {
        ...input.loadedCheckpoint.values,
        messages: [...prior, ...continuation],
      },
    };
    const delivery = {
      generation: 'next-native',
      phase: 'complete',
      outcome: 'success',
    };
    const snapshot = {
      ...input.snapshot,
      messages: [
        ...input.snapshot.messages,
        { id: 'second-human', role: 'user', content: 'Follow up.', delivery },
        {
          id: 'second-final',
          role: 'assistant',
          content: 'Followup answer.',
          toolCallIds: [],
          delivery,
        },
      ],
    };
    const turn = captureTurn(captureBaseline({ messages: prior }), {
      memoryScope: '11111111-1111-4111-8111-111111111111',
      owner: 'app-owner',
      generation: 'generation',
      threadId: 'thread',
      humanId: 'second-human',
      humanContent: 'Follow up.',
    });
    const candidate = {
      ...input,
      turn,
      observedState: state,
      loadedCheckpoint: structuredClone(state),
      history: [structuredClone(state)],
      snapshot,
      loadedSnapshot: structuredClone(snapshot),
    };
    expect(captureAuthority(candidate).kind).toBe('terminal');
    const incomplete = captureTurn(
      captureBaseline({ messages: prior.slice(1) }),
      {
        memoryScope: '11111111-1111-4111-8111-111111111111',
        owner: 'app-owner',
        generation: 'generation',
        threadId: 'thread',
        humanId: 'second-human',
        humanContent: 'Follow up.',
      }
    );
    expect(captureAuthority({ ...candidate, turn: incomplete }).kind).toBe(
      'unconfirmed'
    );
    candidate.loadedCheckpoint.values.messages[2].content =
      'Prior result changed';
    expect(captureAuthority(candidate).kind).toBe('unconfirmed');
  });
  it('restoration requires an explicit current owner binding with a fresh exact checkpoint', () => {
    const input = authorityInput();
    expect(
      captureAuthority({
        ...input,
        memoryScope: '11111111-1111-4111-8111-111111111111',
        owner: 'app-owner',
        generation: 'new-generation',
      }).kind
    ).toBe('unconfirmed');
    const turn = captureTurn(captureBaseline(), {
      memoryScope: '11111111-1111-4111-8111-111111111111',
      owner: 'app-owner',
      generation: 'new-generation',
      threadId: 'thread',
      humanId: 'human',
      humanContent: 'Inspect runway.',
    });
    expect(
      captureAuthority({
        ...input,
        turn,
        memoryScope: '11111111-1111-4111-8111-111111111111',
        owner: 'app-owner',
        generation: 'new-generation',
      }).kind
    ).toBe('terminal');
  });
});

describe('Memory owner binding', () => {
  it('rejects a raw checkpoint owner different from captured scope', () => {
    const input = authorityInput();
    for (const v of [
      input.observedState.values,
      input.history[0].values,
      input.loadedCheckpoint.values,
      input.snapshot.values,
      input.loadedSnapshot.values,
    ])
      (v as any).memory_scope_owner = '22222222-2222-4222-8222-222222222222';
    expect(captureAuthority(input).kind).toBe('unconfirmed');
  });
});

describe('historical Memory checkpoint projection', () => {
  it.each([
    {},
    { '/memories/AGENTS.md': '' },
    { '/memories/AGENTS.md': ' \n\nLiteral\t' },
  ])('projects only confirmed historical contents %j', (contents) => {
    const i = authorityInput();
    for (const v of [
      i.observedState.values,
      i.history[0].values,
      i.loadedCheckpoint.values,
      i.snapshot.values,
      i.loadedSnapshot.values,
    ])
      (v as any).memory_contents = contents;
    const a = captureAuthority(i);
    expect(a.kind).toBe('terminal');
    const result = projectMemory({
      owner: i.owner,
      currentOwner: i.owner,
      generation: i.generation,
      currentGeneration: i.generation,
      scope: i.memoryScope,
      source: 'checkpoint',
      authority: a,
    });
    expect(result).toMatchObject({
      kind: 'checkpoint',
      file: Object.hasOwn(contents, '/memories/AGENTS.md')
        ? 'present'
        : 'missing',
      checkpointId: 'checkpoint',
    });
    if (Object.hasOwn(contents, '/memories/AGENTS.md'))
      expect((result as any).contents).toBe(
        (contents as any)['/memories/AGENTS.md']
      );
    expect(
      projectMemory({
        owner: i.owner,
        currentOwner: i.owner,
        generation: i.generation,
        currentGeneration: 'stale',
        scope: i.memoryScope,
        source: 'checkpoint',
        authority: a,
      }).kind
    ).toBe('unavailable');
  });
  it('requires complete captured scope and raw owner binding, independent of app identity', () => {
    for (const mutate of [
      (i: any) => {
        delete i.memoryScope;
      },
      (i: any) => {
        i.memoryScope = '22222222-2222-4222-8222-222222222222';
      },
      (i: any) => {
        delete i.turn.memoryScope;
      },
    ]) {
      const i = structuredClone(authorityInput());
      mutate(i);
      expect(captureAuthority(i).kind).toBe('unconfirmed');
    }
  });
  it('never derives missing contents from tools or answer text and rejects corrupted maps', () => {
    const i = authorityInput();
    for (const v of [
      i.observedState.values,
      i.history[0].values,
      i.loadedCheckpoint.values,
      i.snapshot.values,
      i.loadedSnapshot.values,
    ])
      delete (v as any).memory_contents;
    const a = captureAuthority(i);
    expect(a.kind).toBe('terminal');
    expect(
      projectMemory({
        owner: i.owner,
        currentOwner: i.owner,
        generation: i.generation,
        currentGeneration: i.generation,
        scope: i.memoryScope,
        source: 'checkpoint',
        authority: a,
      }).kind
    ).toBe('unavailable');
  });
});
