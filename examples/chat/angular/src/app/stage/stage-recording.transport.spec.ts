import { describe, expect, it } from 'vitest';
import type { AgentTransport, StreamEvent } from '@threadplane/langgraph';
import { StageRecordingTransport } from './stage-recording.transport';

function inner(events: StreamEvent[]): AgentTransport {
  return {
    async *stream() { for (const e of events) yield e; },
    async getHistory() { return [{ values: {} } as never]; },
  };
}
async function drain(iter: AsyncIterable<StreamEvent>): Promise<void> { for await (const _ of iter) { /* drain */ } }

describe('StageRecordingTransport', () => {
  it('records each stream as a run tagged with the action the script announced', async () => {
    let now = 0;
    const t = new StageRecordingTransport(inner([{ type: 'values' } as never, { type: 'values' } as never]), () => (now += 10));
    t.beginRun('stream', { kind: 'submit', message: 'Q1' });
    await drain(t.stream('chat', 'thread-1', {}, new AbortController().signal));
    const rec = t.recording();
    expect(rec.runs).toHaveLength(1);
    expect(rec.runs[0]).toMatchObject({ beat: 'stream', action: { kind: 'submit', message: 'Q1' } });
    expect(rec.runs[0].events.map((e) => e.tMs)).toEqual([10, 20]);
  });
  it('records a reload as a run with no events, and history responses with the run count', async () => {
    const t = new StageRecordingTransport(inner([]));
    t.beginRun('stream', { kind: 'submit', message: 'Q1' });
    await drain(t.stream('chat', 'thread-1', {}, new AbortController().signal));
    t.beginRun('persist', { kind: 'reload' });
    t.markReload();
    await t.getHistory('thread-1', new AbortController().signal);
    const rec = t.recording();
    expect(rec.runs[1]).toMatchObject({ beat: 'persist', action: { kind: 'reload' }, events: [] });
    expect(rec.histories).toEqual([{ afterRun: 2, states: [{ values: {} }] }]);
  });
  it('refuses a stream without an announced action', async () => {
    const t = new StageRecordingTransport(inner([]));
    await expect(drain(t.stream('chat', 'thread-1', {}, new AbortController().signal))).rejects.toThrow(/beginRun/);
  });
  it('captures the thread id the session reports', () => {
    const t = new StageRecordingTransport(inner([]));
    t.onThreadId('thread-9');
    expect(t.recording().threadId).toBe('thread-9');
  });
  it('creates the thread through the inner transport, and says so when it cannot', async () => {
    const sig = new AbortController().signal;
    const creating: AgentTransport = { ...inner([]), createThread: async () => 'thread-7' };
    expect(await new StageRecordingTransport(creating).createThread(sig)).toBe('thread-7');
    expect(() => new StageRecordingTransport(inner([])).createThread(sig)).toThrow(/cannot create a thread/);
  });
});
