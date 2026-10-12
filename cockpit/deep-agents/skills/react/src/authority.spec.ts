import { describe, it, expect } from 'vitest';
import {
  captureAuthority,
  captureBaseline,
  captureTurn,
  copyData,
} from './authority';
import { authorityInput } from './test-fixtures';
describe('terminal owned Skills authority', () => {
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
