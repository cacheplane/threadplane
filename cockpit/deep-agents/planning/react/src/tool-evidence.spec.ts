import { describe, expect, it } from 'vitest';
import { writeEvidence } from './tool-evidence';

const todos = [{ content: 'Still working', status: 'in_progress' }];
const human = { id: 'h', type: 'human', content: 'Plan' };
const ai = (ids = ['call'], args: unknown = { todos }) => ({
  id: `ai-${ids.join('-')}`,
  type: 'ai',
  content: '',
  tool_calls: ids.map((id) => ({
    id,
    name: 'write_todos',
    args,
    type: 'tool_call',
  })),
  invalid_tool_calls: [],
});
const tool = (
  id = 'call',
  status = 'success',
  name: string | null = 'write_todos'
) => ({
  id: `result-${id}`,
  type: 'tool',
  tool_call_id: id,
  name,
  status,
  content: "Updated todo list to [{'content': 'prose must not be parsed'}]",
});
const answer = {
  id: 'answer',
  type: 'ai',
  content: 'Done',
  tool_calls: [],
  invalid_tool_calls: [],
};
describe('current-turn raw write evidence', () => {
  it('uses whole-list call arguments and authoritative raw success', () => {
    expect(writeEvidence([human, ai(), tool(), answer], 'h')).toEqual({
      kind: 'replacement',
      items: todos,
      callId: 'call',
    });
  });
  it('accepts successful empty clear', () => {
    expect(
      writeEvidence(
        [human, ai(['clear'], { todos: [] }), tool('clear'), answer],
        'h'
      )
    ).toEqual({ kind: 'replacement', items: [], callId: 'clear' });
  });
  it('reports no write despite assistant todo prose', () => {
    expect(writeEvidence([human, answer], 'h')).toEqual({ kind: 'none' });
  });
  it('recognizes nameless parallel rejection', () => {
    expect(
      writeEvidence(
        [
          human,
          ai(['a', 'b']),
          tool('a', 'error', null),
          tool('b', 'error', null),
          answer,
        ],
        'h'
      ).kind
    ).toBe('rejected');
  });
  it('recognizes schema rejection without validating rejected arguments', () => {
    expect(
      writeEvidence([human, ai(['bad'], {}), tool('bad', 'error'), answer], 'h')
        .kind
    ).toBe('rejected');
  });
  it('recovers after rejected parallel writes with later single success', () => {
    expect(
      writeEvidence(
        [
          human,
          ai(['a', 'b']),
          tool('a', 'error', null),
          tool('b', 'error', null),
          ai(['recover']),
          tool('recover'),
          answer,
        ],
        'h'
      )
    ).toEqual({ kind: 'replacement', items: todos, callId: 'recover' });
  });
  it('ignores prior-turn writes', () => {
    expect(
      writeEvidence(
        [{ ...human, id: 'old' }, ai(), tool(), { ...human, id: 'h' }, answer],
        'h'
      )
    ).toEqual({ kind: 'none' });
  });
  it.each(
    [
      [human, ai(), answer],
      [human, ai(), tool(), tool(), answer],
      [human, ai(['a', 'a']), tool('a'), answer],
      [human, ai(['a', 'b']), tool('a'), tool('b'), answer],
      [human, ai(), { ...tool(), status: undefined }, answer],
      [human, ai(), tool('call', 'success', null), answer],
      [human, ai(), tool('other'), answer],
      [
        human,
        ai(['bad'], { todos: [{ content: 'Bad', status: 'done' }] }),
        tool('bad'),
        answer,
      ],
      [human, ai(['bad'], { todos, extra: true }), tool('bad'), answer],
      [human, { ...ai(), invalid_tool_calls: [{ id: 'bad' }] }, tool(), answer],
      [human, ai(), tool(), { ...human, id: 'foreign' }, answer],
      [human, ai(), { ...tool(), content: { todos } }, answer],
    ].map((messages) => ({ messages }))
  )('rejects pending, ambiguous or unsupported evidence %#', ({ messages }) => {
    expect(writeEvidence(messages, 'h').kind).toBe('invalid');
  });
  it('rejects getters without invocation', () => {
    let reads = 0;
    const result = Object.defineProperty({ ...tool() }, 'status', {
      enumerable: true,
      get() {
        reads++;
        return 'success';
      },
    });
    expect(writeEvidence([human, ai(), result, answer], 'h').kind).toBe(
      'invalid'
    );
    expect(reads).toBe(0);
  });
});
