import { describe, expect, it } from 'vitest';
import { HeroRecordingTransport } from './hero-recording.transport';
import type { AgentTransport, StreamEvent } from '@threadplane/langgraph';

function innerWith(events: StreamEvent[]): AgentTransport {
  return { async *stream() { for (const e of events) yield e; } };
}

describe('HeroRecordingTransport', () => {
  it('passes events through and records them with offsets', async () => {
    let now = 1000;
    const t = new HeroRecordingTransport(innerWith([{ type: 'values' }, { type: 'messages' }]), () => (now += 40));
    const out: StreamEvent[] = [];
    for await (const e of t.stream('a', null, {}, new AbortController().signal)) out.push(e);
    expect(out).toEqual([{ type: 'values' }, { type: 'messages' }]);
    const rec = t.recording();
    expect(rec.runs).toHaveLength(1);
    expect(rec.runs[0].events.map((e) => e.tMs)).toEqual([40, 80]);
  });
  it('labels runs in order: prompt, resume, genui, then run-N', async () => {
    const t = new HeroRecordingTransport(innerWith([{ type: 'values' }]), () => 0);
    const sig = new AbortController().signal;
    for (let i = 0; i < 4; i++) for await (const _ of t.stream('a', null, {}, sig)) { /* drain */ }
    expect(t.recording().runs.map((r) => r.label)).toEqual(['prompt', 'resume', 'genui', 'run-4']);
  });
  it('does not register a run that throws before yielding any event, and re-labels the next run as prompt', async () => {
    const throwingInner: AgentTransport = {
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return { next: () => Promise.reject(new Error('boom')) };
          },
        };
      },
    };
    const t = new HeroRecordingTransport(throwingInner, () => 0);
    const sig = new AbortController().signal;
    await expect((async () => { for await (const _ of t.stream('a', null, {}, sig)) { /* drain */ } })()).rejects.toThrow('boom');
    expect(t.recording().runs).toEqual([]);

    const successful = new HeroRecordingTransport(innerWith([{ type: 'values' }]), () => 0);
    for await (const _ of successful.stream('a', null, {}, sig)) { /* drain */ }
    expect(successful.recording().runs.map((r) => r.label)).toEqual(['prompt']);
  });
  it('registers a run with one event even if the consumer stops iterating early', async () => {
    const t = new HeroRecordingTransport(innerWith([{ type: 'values' }, { type: 'messages' }]), () => 0);
    const sig = new AbortController().signal;
    for await (const _ of t.stream('a', null, {}, sig)) break;
    expect(t.recording().runs).toHaveLength(1);
    expect(t.recording().runs[0].events).toHaveLength(1);
  });
  it('creates the thread through the inner transport, and says so when it cannot', async () => {
    const sig = new AbortController().signal;
    const creating: AgentTransport = { ...innerWith([]), createThread: async () => 'thread-7' };
    expect(await new HeroRecordingTransport(creating, () => 0).createThread(sig)).toBe('thread-7');
    expect(() => new HeroRecordingTransport(innerWith([]), () => 0).createThread(sig)).toThrow(
      /cannot create a thread/,
    );
  });
  it('recordedAt is stable across recording() calls', async () => {
    const t = new HeroRecordingTransport(innerWith([{ type: 'values' }]), () => 0);
    const sig = new AbortController().signal;
    for await (const _ of t.stream('a', null, {}, sig)) { /* drain */ }
    const first = t.recording().recordedAt;
    const second = t.recording().recordedAt;
    expect(first).toBe(second);
  });
});
