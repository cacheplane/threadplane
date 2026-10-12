import { describe, it, expect } from 'vitest';
import {
  captureAuthority,
  captureBaseline,
  captureTurn,
  copyData,
} from './authority';
import { authorityInput } from './test-fixtures';
describe('terminal owned Skills authority', () => {
  function withPrivateErrors() {
    const input = authorityInput();
    for (const values of [
      input.observedState.values,
      input.history[0].values,
      input.loadedCheckpoint.values,
      input.snapshot.values,
      input.loadedSnapshot.values,
    ]) {
      (values as any).skills_load_errors = [
        { path: '/skills/broken/SKILL.md', error: 'Invalid frontmatter' },
      ];
    }
    return input;
  }
  it.each([
    { keys: [] },
    { keys: ['skills_metadata'] },
    { keys: ['skills_load_errors'] },
    { keys: ['skills_metadata', 'skills_load_errors'] },
  ])(
    'confirms only absent live private keys $keys and retains exact checkpoint metadata',
    ({ keys }) => {
      const input = withPrivateErrors();
      for (const key of keys) delete (input.snapshot.values as any)[key];
      const authority = captureAuthority(input);
      expect(authority.kind).toBe('terminal');
      if (authority.kind !== 'terminal')
        throw Error('Unconfirmed private projection');
      expect(authority.values).toEqual(input.loadedCheckpoint.values);
      expect(authority.rawToolStatuses).toEqual({ read: 'success' });
    }
  );
  it.each(['skills_metadata', 'skills_load_errors'])(
    'rejects conflicting or present undefined private %s',
    (key) => {
      for (const value of [[], undefined]) {
        const input = withPrivateErrors();
        delete (input.snapshot.values as any)[
          key === 'skills_metadata' ? 'skills_load_errors' : 'skills_metadata'
        ];
        (input.snapshot.values as any)[key] = value;
        expect(captureAuthority(input).kind).toBe('unconfirmed');
      }
    }
  );
  it.each(['skills_metadata', 'skills_load_errors'])(
    'requires loaded private %s even when live omits both',
    (key) => {
      for (const remove of [true, false]) {
        const input = withPrivateErrors();
        delete (input.snapshot.values as any).skills_metadata;
        delete (input.snapshot.values as any).skills_load_errors;
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
        delete i.snapshot.values.skills_metadata[0].description;
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
  it('does not accept custom metadata when the checkpoint lacks it', () => {
    const input = authorityInput();
    for (const values of [
      input.observedState.values,
      input.history[0].values,
      input.loadedCheckpoint.values,
      input.loadedSnapshot.values,
    ])
      delete (values as any).skills_metadata;
    expect(captureAuthority(input).kind).toBe('unconfirmed');
    delete (input.snapshot.values as any).skills_metadata;
    (input.snapshot as any).customEvents = [
      { name: 'skills_visibility', data: { skills_metadata: ['untrusted'] } },
    ];
    const authority = captureAuthority(input);
    expect(authority.kind).toBe('terminal');
    if (authority.kind !== 'terminal')
      throw Error('Unconfirmed ordinary values');
    expect(Object.hasOwn(authority.values, 'skills_metadata')).toBe(false);
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
      delete (input.snapshot.values as any).skills_metadata;
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
    target.values.skills_metadata = [];
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
      owner: 'owner',
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
        owner: 'owner',
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
        owner: 'new-owner',
        generation: 'new-generation',
      }).kind
    ).toBe('unconfirmed');
    const turn = captureTurn(captureBaseline(), {
      owner: 'new-owner',
      generation: 'new-generation',
      threadId: 'thread',
      humanId: 'human',
      humanContent: 'Inspect runway.',
    });
    expect(
      captureAuthority({
        ...input,
        turn,
        owner: 'new-owner',
        generation: 'new-generation',
      }).kind
    ).toBe('terminal');
  });
});
