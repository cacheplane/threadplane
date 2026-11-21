import { describe, expect, it, vi } from 'vitest';
import { HERO_REPLAY_THREAD_ID, HeroReplayTransport, type ReplayClock } from './hero-replay.transport';
import type { HeroRecording } from './hero-recording.types';

const recording: HeroRecording = {
  version: 1,
  recordedAt: '2026-09-02T00:00:00.000Z',
  runs: [
    { label: 'prompt', events: [
      { tMs: 0, event: { type: 'messages', messages: [{ id: 'a', type: 'ai', content: 'He' }] } },
      { tMs: 5, event: { type: 'messages', messages: [{ id: 'a', type: 'ai', content: 'Hello' }] } },
      { tMs: 2000, event: { type: 'interrupt' } },
    ] },
    { label: 'resume', events: [{ tMs: 0, event: { type: 'values' } }] },
    { label: 'genui', events: [{ tMs: 0, event: { type: 'values' } }] },
  ],
};

function fakeClock(): ReplayClock & { waits: number[] } {
  const waits: number[] = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}
async function collect(it: AsyncIterable<unknown>): Promise<unknown[]> { const out: unknown[] = []; for await (const e of it) out.push(e); return out; }

describe('HeroReplayTransport', () => {
  it('plays runs in order across successive stream() calls', async () => {
    const t = new HeroReplayTransport(fakeClock(), async () => recording);
    const ctl = new AbortController();
    const first = await collect(t.stream('hero', null, {}, ctl.signal));
    const second = await collect(t.stream('hero', null, {}, ctl.signal));
    expect(first).toHaveLength(3);
    expect(second).toEqual([{ type: 'values' }]);
  });
  it('paces by recorded gaps at their real speed, capped at 600 ms', async () => {
    const clock = fakeClock();
    const t = new HeroReplayTransport(clock, async () => recording);
    await collect(t.stream('hero', null, {}, new AbortController().signal));
    expect(clock.waits).toEqual([0, 5, 600]);
  });
  it('stops when the signal aborts', async () => {
    const t = new HeroReplayTransport(fakeClock(), async () => recording);
    const ctl = new AbortController();
    const out: unknown[] = [];
    for await (const e of t.stream('hero', null, {}, ctl.signal)) { out.push(e); ctl.abort(); }
    expect(out).toHaveLength(1);
  });
  it('reset() rewinds to the first run', async () => {
    const t = new HeroReplayTransport(fakeClock(), async () => recording);
    const sig = new AbortController().signal;
    await collect(t.stream('hero', null, {}, sig));
    t.reset();
    expect(await collect(t.stream('hero', null, {}, sig))).toHaveLength(3);
  });
  it('yields nothing once every run is consumed', async () => {
    const t = new HeroReplayTransport(fakeClock(), async () => recording);
    const sig = new AbortController().signal;
    for (let i = 0; i < 3; i++) await collect(t.stream('hero', null, {}, sig));
    expect(await collect(t.stream('hero', null, {}, sig))).toEqual([]);
  });
  it('loads the recording only once', async () => {
    const load = vi.fn(async () => recording);
    const t = new HeroReplayTransport(fakeClock(), load);
    const sig = new AbortController().signal;
    await collect(t.stream('hero', null, {}, sig));
    await collect(t.stream('hero', null, {}, sig));
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('ready() resolves after a successful load and does not call load twice', async () => {
    const load = vi.fn(async () => recording);
    const t = new HeroReplayTransport(fakeClock(), load);
    await t.ready();
    await t.ready();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('ready() rejects on a failed load, and retries load on the next ready() call', async () => {
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fixture missing');
      return recording;
    });
    const t = new HeroReplayTransport(fakeClock(), load);
    await expect(t.ready()).rejects.toThrow('fixture missing');
    await expect(t.ready()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('creates the one thread a session asks for before its first run', async () => {
    const t = new HeroReplayTransport(fakeClock(), async () => recording);
    expect(await t.createThread()).toBe(HERO_REPLAY_THREAD_ID);
  });
  it('answers a run with its prompt renamed to the id the session sent', async () => {
    const human = (id: string, content: string) => ({ id, type: 'human', content });
    const prompted: HeroRecording = {
      version: 1,
      recordedAt: '2026-09-02T00:00:00.000Z',
      runs: [
        { label: 'prompt', events: [{ tMs: 0, event: { type: 'values', messages: [human('recorded', 'Clean up')] } as never }] },
        { label: 'resume', events: [{ tMs: 0, event: { type: 'values', messages: [human('recorded', 'Clean up')] } as never }] },
        { label: 'genui', events: [{ tMs: 0, event: { type: 'values', messages: [human('recorded', 'Clean up'), human('recorded-2', 'Form')] } as never }] },
      ],
    };
    const t = new HeroReplayTransport(fakeClock(), async () => prompted);
    const sig = new AbortController().signal;
    const ids = (events: unknown[]) =>
      (events[0] as { messages: { id: string }[] }).messages.map((message) => message.id);

    // A session names the user message it submits; the recording carries
    // another session's name for the same prompt.
    expect(ids(await collect(t.stream('hero', null, { messages: [human('live-1', 'Clean up')] }, sig)))).toEqual(['live-1']);
    // A resume sends no user message; the earlier prompt keeps its new name.
    expect(ids(await collect(t.stream('hero', null, null, sig)))).toEqual(['live-1']);
    expect(ids(await collect(t.stream('hero', null, { messages: [human('live-2', 'Form')] }, sig)))).toEqual(['live-1', 'live-2']);

    // A restart replays from the first run for a new session and its new ids.
    t.reset();
    expect(ids(await collect(t.stream('hero', null, { messages: [human('again', 'Clean up')] }, sig)))).toEqual(['again']);
  });
  it('never sleeps a negative gap when tMs goes backwards', async () => {
    const clock = fakeClock();
    const backwards: HeroRecording = {
      version: 1,
      recordedAt: '2026-09-02T00:00:00.000Z',
      runs: [
        { label: 'prompt', events: [
          { tMs: 100, event: { type: 'values' } },
          { tMs: 50, event: { type: 'values' } },
        ] },
        { label: 'resume', events: [{ tMs: 0, event: { type: 'values' } }] },
        { label: 'genui', events: [{ tMs: 0, event: { type: 'values' } }] },
      ],
    };
    const t = new HeroReplayTransport(clock, async () => backwards);
    await collect(t.stream('hero', null, {}, new AbortController().signal));
    expect(clock.waits[0]).toBe(100);
    expect(clock.waits[1]).toBe(0);
  });
});
