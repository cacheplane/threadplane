import { describe, expect, it } from 'vitest';
import { ConversationRecords } from './records';
import { captureTerminal, type Canonical } from './authority';
function saved(id = 'thread-a', suffix = '1'): Canonical {
  const result = captureTerminal(
    {
      status: 'idle',
      interrupts: [],
      subgraphs: [],
      toolCalls: [],
      messages: [
        {
          id: 'h' + suffix,
          role: 'user',
          content: 'Question',
          delivery: {
            generation: 'h' + suffix,
            phase: 'complete',
            outcome: 'success',
          },
        },
        {
          id: 'a' + suffix,
          role: 'assistant',
          content: 'Answer',
          delivery: {
            generation: 'a' + suffix,
            phase: 'complete',
            outcome: 'success',
          },
        },
      ],
      history: [
        {
          checkpoint: {
            thread_id: id,
            checkpoint_ns: '',
            checkpoint_id: 'checkpoint-' + suffix,
          },
          next: [],
        },
      ],
    },
    id
  );
  if (!result) throw new Error('Invalid authored canonical fixture');
  return result;
}
describe('page-owned conversation records', () => {
  it('accepts a fresh confirmed extension without changing its existing prefix', () => {
    const r = new ConversationRecords(),
      a = r.create(),
      first = saved();
    r.confirmThread(a.key, 'thread-a');
    r.confirm(a.key, first, 'run-1');
    const second = saved('thread-a', '2');
    const extended = captureTerminal(
      {
        status: 'idle',
        interrupts: [],
        subgraphs: [],
        toolCalls: [],
        messages: [...first.messages, ...second.messages],
        history: [
          {
            checkpoint: {
              thread_id: 'thread-a',
              checkpoint_ns: '',
              checkpoint_id: 'next',
            },
            next: [],
          },
        ],
      },
      'thread-a'
    );
    if (!extended) throw new Error('Invalid authored extension');
    r.confirm(a.key, extended, 'run-2');
    expect(r.get(a.key)?.canonical?.messages).toHaveLength(4);
    expect(r.get(a.key)?.generations).toEqual(['run-1', 'run-2']);
  });
  it('retains stable local identity through confirmed remote creation', () => {
    const records = new ConversationRecords(),
      a = records.create();
    records.setDraft(a.key, 'draft');
    records.confirmThread(a.key, 'thread-a');
    expect(records.get(a.key)).toMatchObject({
      key: a.key,
      threadId: 'thread-a',
      draft: 'draft',
      label: 'Conversation 1',
    });
    expect(records.list()).toHaveLength(1);
    expect(Object.isFrozen(records.get(a.key))).toBe(true);
  });
  it('keeps independent drafts and titles for confirmed conversations', () => {
    const r = new ConversationRecords(),
      a = r.create();
    r.confirmThread(a.key, 'thread-a');
    r.setDraft(a.key, 'draft A');
    const b = r.create();
    r.confirmThread(b.key, 'thread-b');
    r.setDraft(b.key, 'draft B');
    expect(r.setTitle(a.key, '<b>Literal A</b>', a.version)).toBe(true);
    expect(r.get(a.key)).toMatchObject({
      draft: 'draft A',
      label: '<b>Literal A</b>',
    });
    expect(r.get(b.key)).toMatchObject({
      draft: 'draft B',
      label: 'Conversation 2',
    });
    expect(a.key).not.toBe(b.key);
    expect(r.list()).toHaveLength(2);
  });
  it('New replaces only an uncreated draft and preserves saved records', () => {
    const r = new ConversationRecords(),
      a = r.create();
    r.confirmThread(a.key, 'thread-a');
    r.setDraft(a.key, 'keep');
    const unsent = r.create();
    r.setDraft(unsent.key, 'discard');
    const blank = r.create();
    expect(r.get(unsent.key)).toBeUndefined();
    expect(r.get(blank.key)?.draft).toBe('');
    expect(r.get(a.key)?.draft).toBe('keep');
    expect(r.list()).toHaveLength(2);
  });
  it('stores immutable canonical evidence and used generation identities', () => {
    const r = new ConversationRecords(),
      a = r.create();
    r.confirmThread(a.key, 'thread-a');
    r.confirm(a.key, saved(), 'run-1');
    expect(r.get(a.key)?.canonical).toEqual(saved());
    expect(r.get(a.key)?.generations).toEqual(['run-1']);
    expect(Object.isFrozen(r.get(a.key)?.canonical?.messages)).toBe(true);
    expect(() => r.confirm(a.key, saved(), 'run-1')).toThrow();
  });
  it('rejects unknown keys, foreign evidence and duplicate remote IDs', () => {
    const r = new ConversationRecords(),
      a = r.create();
    r.confirmThread(a.key, 'thread-a');
    const b = r.create();
    expect(r.get('foreign')).toBeUndefined();
    expect(() => r.confirmThread(b.key, 'thread-a')).toThrow();
    expect(() => r.setDraft('foreign', 'text')).toThrow();
    expect(() => r.confirm(a.key, saved('foreign'), 'run-1')).toThrow();
    expect(() => r.confirmThread(a.key, 'different')).toThrow();
  });
  it('never repairs an unavailable record through later evidence or metadata', () => {
    const r = new ConversationRecords(),
      a = r.create();
    r.confirmThread(a.key, 'thread-a');
    r.markUnavailable(a.key);
    expect(r.get(a.key)?.availability).toBe('unavailable');
    expect(() => r.confirm(a.key, saved(), 'run-1')).toThrow();
    expect(r.setTitle(a.key, 'Late title', 0)).toBe(false);
    expect(r.create().availability).toBe('available');
    expect(r.get(a.key)?.availability).toBe('unavailable');
  });
  it('fences late title publication using a record version', () => {
    const r = new ConversationRecords(),
      a = r.create();
    r.confirmThread(a.key, 'thread-a');
    expect(r.setTitle(a.key, 'First', 0)).toBe(true);
    const version = r.invalidate(a.key);
    expect(version).toBe(1);
    expect(r.setTitle(a.key, 'Stale', 0)).toBe(false);
    expect(r.get(a.key)?.label).toBe('First');
    expect(r.setTitle(a.key, 'Latest', version)).toBe(true);
  });
  it('rejects a changed confirmed prefix without replacing saved evidence', () => {
    const r = new ConversationRecords(),
      a = r.create();
    r.confirmThread(a.key, 'thread-a');
    const canonical = saved();
    r.confirm(a.key, canonical, 'run-1');
    expect(() => r.confirm(a.key, saved('thread-a', '2'), 'run-2')).toThrow();
    expect(r.get(a.key)?.canonical).toEqual(canonical);
  });
});
