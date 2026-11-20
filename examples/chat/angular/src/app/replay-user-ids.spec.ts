import { describe, expect, it } from 'vitest';
import { ReplayUserIds } from './replay-user-ids';

const human = (id: string, content: unknown) => ({ id, type: 'human', content });
const ai = (id: string, content: string) => ({ id, type: 'ai', content });
/** A `values` frame as the transport delivers it: the state under `data`, and spread beside it. */
const values = (messages: unknown[]) => ({ event: { type: 'values', messages, data: { messages } } });
const sent = (id: string, content: unknown) => ({ messages: [human(id, content)] });

describe('ReplayUserIds', () => {
  it('renames the prompt a recorded run added to the id the session sent', () => {
    const ids = new ReplayUserIds();
    const run = [values([human('recorded-1', 'Q1')]), values([human('recorded-1', 'Q1'), ai('a1', 'A1')])];
    ids.adopt(sent('live-1', 'Q1'), run);

    expect(ids.translate(run[1].event)).toEqual({
      type: 'values',
      messages: [human('live-1', 'Q1'), ai('a1', 'A1')],
      data: { messages: [human('live-1', 'Q1'), ai('a1', 'A1')] },
    });
  });

  it('leaves the recording untouched and returns it as it is when nothing is related', () => {
    const ids = new ReplayUserIds();
    const event = values([human('recorded-1', 'Q1')]).event;
    expect(ids.translate(event)).toBe(event);

    ids.adopt(sent('live-1', 'Q1'), [{ event }]);
    const renamed = ids.translate(event);
    expect(renamed).not.toBe(event);
    expect(event.messages[0]).toEqual(human('recorded-1', 'Q1'));
    // A branch without a related message keeps its reference.
    const other = { type: 'updates', data: { generate: { messages: [ai('a1', 'A1')] } } };
    expect(ids.translate(other)).toBe(other);
  });

  it('relates each later run to the prompt nothing has claimed yet', () => {
    const ids = new ReplayUserIds();
    const first = [values([human('r1', 'Q1'), ai('a1', 'A1')])];
    const second = [values([human('r1', 'Q1'), ai('a1', 'A1'), human('r2', 'Q2'), ai('a2', 'A2')])];
    ids.adopt(sent('live-1', 'Q1'), first);
    ids.adopt(sent('live-2', 'Q2'), second);

    const ordered = (ids.translate(second[0].event) as { messages: { id: string }[] }).messages.map((m) => m.id);
    expect(ordered).toEqual(['live-1', 'a1', 'live-2', 'a2']);
  });

  it('prefers the unclaimed prompt whose text was sent when a run carries several', () => {
    const ids = new ReplayUserIds();
    // Nothing was related for the earlier prompt (its run was not replayed).
    const run = [values([human('r1', 'Earlier'), ai('a1', 'A1'), human('r2', 'Now')])];
    ids.adopt(sent('live-2', 'Now'), run);
    const renamed = ids.translate(run[0].event) as { messages: { id: string }[] };
    expect(renamed.messages.map((m) => m.id)).toEqual(['r1', 'a1', 'live-2']);
  });

  it('reads a prompt sent as text blocks', () => {
    const ids = new ReplayUserIds();
    const run = [values([human('r1', 'Other'), human('r2', [{ type: 'text', text: 'Look at ' }, { type: 'text', text: 'this' }])])];
    ids.adopt(sent('live', [{ type: 'text', text: 'Look at this' }]), run);
    expect((ids.translate(run[0].event) as { messages: { id: string }[] }).messages.map((m) => m.id)).toEqual(['r1', 'live']);
  });

  it('relates nothing for a run that sends no user message', () => {
    const ids = new ReplayUserIds();
    const run = [values([human('r1', 'Q1'), ai('a1', 'A1')])];
    ids.adopt(null, run);
    ids.adopt({ messages: [{ type: 'tool', id: 't1', content: 'done' }] }, run);
    expect(ids.translate(run[0].event)).toBe(run[0].event);
  });

  it('renames only user messages, never another record that shares the id', () => {
    const ids = new ReplayUserIds();
    const run = [values([human('shared', 'Q1')])];
    ids.adopt(sent('live', 'Q1'), run);
    const state = { values: { messages: [human('shared', 'Q1')], backups: [{ id: 'shared' }] } };
    expect(ids.translate(state)).toEqual({
      values: { messages: [human('live', 'Q1')], backups: [{ id: 'shared' }] },
    });
  });

  it('reset() forgets every relation', () => {
    const ids = new ReplayUserIds();
    const run = [values([human('r1', 'Q1')])];
    ids.adopt(sent('live-1', 'Q1'), run);
    ids.reset();
    expect(ids.translate(run[0].event)).toBe(run[0].event);
    ids.adopt(sent('live-again', 'Q1'), run);
    expect((ids.translate(run[0].event) as { messages: { id: string }[] }).messages[0].id).toBe('live-again');
  });
});
