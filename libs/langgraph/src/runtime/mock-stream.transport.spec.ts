import { describe, it, expect } from 'vitest';
import { createSession } from './create-session';
import { MockAgentTransport } from './mock-stream.transport';

describe('MockAgentTransport', () => {
  it('returns empty batch when no script provided', () => {
    const t = new MockAgentTransport();
    expect(t.nextBatch()).toEqual([]);
  });

  it('returns batches in order from script', () => {
    const batch1 = [{ type: 'values' as const, values: {} }];
    const batch2 = [{ type: 'error' as const, error: 'oops' }];
    const t = new MockAgentTransport([batch1, batch2]);
    expect(t.nextBatch()).toEqual(batch1);
    expect(t.nextBatch()).toEqual(batch2);
  });

  it('returns empty batch when script exhausted', () => {
    const t = new MockAgentTransport([[{ type: 'values' as const, values: {} }]]);
    t.nextBatch();
    expect(t.nextBatch()).toEqual([]);
  });

  it('isStreaming returns false initially', () => {
    expect(new MockAgentTransport().isStreaming()).toBe(false);
  });

  it('emit() triggers events on the stream iterable', async () => {
    const t = new MockAgentTransport();
    const events: unknown[] = [];
    const ac = new AbortController();
    const iter = t.stream('agent', null, {}, ac.signal);
    const collecting = (async () => {
      for await (const e of iter) { events.push(e); }
    })();
    t.emit([{ type: 'values', values: { foo: 1 } }]);
    t.close();
    await collecting;
    expect(events).toHaveLength(1);
  });

  describe('awaitable emit()', () => {
    it('emit() resolves only after the consumer has pulled the batch', async () => {
      const t = new MockAgentTransport();
      const events: unknown[] = [];
      const ac = new AbortController();
      const collecting = (async () => {
        for await (const e of t.stream('agent', null, {}, ac.signal)) { events.push(e); }
      })();

      await t.emit([
        { type: 'values', values: { foo: 1 } },
        { type: 'values', values: { foo: 2 } },
      ]);
      // No bare setTimeout: awaiting emit() is enough for the batch to land.
      expect(events).toHaveLength(2);

      await t.close();
      await collecting;
    });

    it('emit() before the stream starts resolves once the stream drains it', async () => {
      const t = new MockAgentTransport();
      const events: unknown[] = [];
      const ac = new AbortController();
      const emitted = t.emit([{ type: 'values', values: { foo: 1 } }]);
      const collecting = (async () => {
        for await (const e of t.stream('agent', null, {}, ac.signal)) { events.push(e); }
      })();
      await emitted;
      expect(events).toHaveLength(1);
      await t.close();
      await collecting;
    });

    it('flush() resolves without emitting anything', async () => {
      const t = new MockAgentTransport();
      const ac = new AbortController();
      const collecting = (async () => {
        for await (const _ of t.stream('agent', null, {}, ac.signal)) { /* noop */ }
      })();
      await t.emit([{ type: 'values', values: { foo: 1 } }]);
      await t.flush();
      expect(t.isStreaming()).toBe(true);
      await t.close();
      await collecting;
    });

    it('close() resolves once the run has finished', async () => {
      const t = new MockAgentTransport();
      const ac = new AbortController();
      const collecting = (async () => {
        for await (const _ of t.stream('agent', null, {}, ac.signal)) { /* noop */ }
      })();
      await t.close();
      expect(t.isStreaming()).toBe(false);
      await collecting;
    });

    it('emitError() resolves once the stream has thrown', async () => {
      const t = new MockAgentTransport();
      const ac = new AbortController();
      let thrown: unknown;
      const collecting = (async () => {
        try {
          for await (const _ of t.stream('agent', null, {}, ac.signal)) { /* noop */ }
        } catch (e) { thrown = e; }
      })();
      await t.emitError(new Error('transport error'));
      expect(thrown).toBeInstanceOf(Error);
      await collecting;
    });

    it('emit() after the run has finished resolves instead of hanging', async () => {
      const t = new MockAgentTransport();
      const ac = new AbortController();
      const collecting = (async () => {
        for await (const _ of t.stream('agent', null, {}, ac.signal)) { /* noop */ }
      })();
      await t.close();
      await collecting;
      await expect(t.emit([{ type: 'values', values: { foo: 1 } }])).resolves.toBeUndefined();
      await expect(t.flush()).resolves.toBeUndefined();
    });
  });

  it('backs a session created without a thread id', async () => {
    const t = new MockAgentTransport();
    const session = createSession({ assistantId: 'agent', transport: t });
    expect(session.threadId).toBeUndefined();
    const submitted = session.submit('Hello');
    await t.flush();
    expect(t.createdThreads).toEqual(['mock-thread-1']);
    expect(t.streams.map((stream) => stream.threadId)).toEqual(['mock-thread-1']);
    await t.emit([
      { type: 'values', messages: [{ id: 'ai-1', type: 'ai', content: 'Hi' }] },
    ]);
    await t.close();
    await expect(submitted).resolves.toBe('success');
    expect(session.threadId).toBe('mock-thread-1');
    expect(
      session.getSnapshot().messages.map((message) => [message.role, message.content]),
    ).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Hi'],
    ]);
    await session.dispose();
  });

  describe('behind a real session', () => {
    type Wire = { id: string; type: string; content: string };
    /** A run's last event as a server sends it: the saved state under `data`. */
    const saved = (messages: Wire[], state: Record<string, unknown> = {}) => ({
      type: 'values' as const,
      data: { messages, ...state },
    });
    const transcript = (session: { getSnapshot(): { messages: readonly { role: string; content: string }[] } }) =>
      session.getSnapshot().messages.map((message) => [message.role, message.content]);
    /** What the session sent as the run's input messages. */
    const sent = (t: MockAgentTransport, index: number) =>
      (t.streams[index].payload as { messages: Wire[] }).messages;

    it('runs a scripted turn to success and reads state from the values event data', async () => {
      const t = new MockAgentTransport();
      const session = createSession({ assistantId: 'agent', transport: t });
      const turn = session.submit('Hello');
      await t.flush();
      expect(session.getSnapshot().status).toBe('running');
      await t.emit([
        { type: 'messages', messages: [{ id: 'a1', type: 'AIMessageChunk', content: 'Hi' }], messageMetadata: {} },
      ]);
      expect(transcript(session)).toEqual([['user', 'Hello'], ['assistant', 'Hi']]);
      await t.emit([
        saved([...sent(t, 0), { id: 'a1', type: 'ai', content: 'Hi there' }], { topic: 'greeting' }),
      ]);
      await t.close();
      await expect(turn).resolves.toBe('success');
      const snapshot = session.getSnapshot();
      expect(snapshot.status).toBe('idle');
      expect(snapshot.error).toBeUndefined();
      expect(transcript(session)).toEqual([['user', 'Hello'], ['assistant', 'Hi there']]);
      // The documented shape: the state is what `data` holds.
      expect(snapshot.state).toMatchObject({ topic: 'greeting' });
      expect(t.runs).toEqual([{ id: 'mock-run-1', threadId: 'mock-thread-1', status: 'success' }]);
      await session.dispose();
    });

    it('does not read state from a values event without data', async () => {
      const t = new MockAgentTransport();
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: t });
      const turn = session.submit('Hello');
      await t.flush();
      await t.emit([
        { type: 'values', values: { topic: 'ignored' }, messages: [{ id: 'a1', type: 'ai', content: 'Hi' }] },
      ]);
      await t.close();
      await turn;
      expect(session.getSnapshot().state).not.toMatchObject({ topic: 'ignored' });
      await session.dispose();
    });

    it('scripts a second turn on the same transport', async () => {
      const t = new MockAgentTransport();
      const session = createSession({ assistantId: 'agent', transport: t });

      const first = session.submit('One');
      await t.flush();
      const afterFirst = [...sent(t, 0), { id: 'a1', type: 'ai', content: 'First answer' }];
      await t.emit([saved(afterFirst)]);
      await t.close();
      await expect(first).resolves.toBe('success');
      expect(t.isStreaming()).toBe(false);

      const second = session.submit('Two');
      await t.flush();
      // The second run is open and waiting: the first run's close did not end it.
      expect(t.isStreaming()).toBe(true);
      expect(session.getSnapshot().status).toBe('running');
      await t.emit([
        saved([...afterFirst, ...sent(t, 1), { id: 'a2', type: 'ai', content: 'Second answer' }]),
      ]);
      await t.close();
      await expect(second).resolves.toBe('success');

      expect(transcript(session)).toEqual([
        ['user', 'One'],
        ['assistant', 'First answer'],
        ['user', 'Two'],
        ['assistant', 'Second answer'],
      ]);
      expect(t.createdThreads).toEqual(['mock-thread-1']);
      expect(t.runs.map((run) => [run.id, run.status])).toEqual([
        ['mock-run-1', 'success'],
        ['mock-run-2', 'success'],
      ]);
      await session.dispose();
    });

    it('scripts each turn before it is submitted', async () => {
      const t = new MockAgentTransport();
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: t });
      for (const [index, answer] of ['First', 'Second'].entries()) {
        void t.emit([
          { type: 'values', data: { messages: [{ id: `a${index}`, type: 'ai', content: answer }] } },
        ]);
        void t.close();
        await expect(session.submit(`Question ${index}`)).resolves.toBe('success');
        expect(session.getSnapshot().messages.at(-1)?.content).toBe(answer);
      }
      expect(t.runs).toHaveLength(2);
      await session.dispose();
    });

    it('offers retry, checkStatus and load, and no regenerate', async () => {
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: new MockAgentTransport() });
      expect(typeof session.retry).toBe('function');
      expect(typeof session.checkStatus).toBe('function');
      expect(typeof session.load).toBe('function');
      expect(session.regenerate).toBeUndefined();
      await session.dispose();
    });

    it('retries a run scripted to fail, with the same user message', async () => {
      const t = new MockAgentTransport();
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: t });
      const turn = session.submit('Question');
      await t.flush();
      await t.emit([
        { type: 'messages', messages: [{ id: 'a1', type: 'AIMessageChunk', content: 'Half' }], messageMetadata: {} },
      ]);
      await t.fail();
      await expect(turn).resolves.toBe('error');
      expect(t.runs[0].status).toBe('error');
      expect(session.getSnapshot()).toMatchObject({
        status: 'error',
        error: { kind: 'server', retryable: true, recovery: 'retry' },
      });

      if (!session.retry) throw new Error('The session has no retry.');
      const again = session.retry();
      await t.flush();
      expect(t.streams).toHaveLength(2);
      // The same message identity, so the thread replaces rather than appends it.
      expect(sent(t, 1)).toEqual(sent(t, 0));
      await t.emit([saved([...sent(t, 1), { id: 'a2', type: 'ai', content: 'Done' }])]);
      await t.close();
      await expect(again).resolves.toBe('success');
      expect(session.getSnapshot().error).toBeUndefined();
      expect(transcript(session)).toEqual([['user', 'Question'], ['assistant', 'Done']]);
      expect(t.runs.map((run) => run.status)).toEqual(['error', 'success']);
      await session.dispose();
    });

    it('settles a thrown stream through checkStatus, then retries it', async () => {
      const t = new MockAgentTransport();
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: t });
      const turn = session.submit('Question');
      await t.flush();
      await t.emitError(new Error('connection lost'));
      // A broken connection proves nothing about the run.
      await expect(turn).resolves.toBe('interrupted');
      expect(session.getSnapshot().error).toMatchObject({ retryable: false, recovery: 'check' });

      await session.checkStatus?.();
      expect(session.getSnapshot().error).toMatchObject({ kind: 'server', recovery: 'retry' });
      const again = session.retry?.();
      await t.flush();
      await t.emit([saved([...sent(t, 1), { id: 'a2', type: 'ai', content: 'Done' }])]);
      await t.close();
      await expect(again).resolves.toBe('success');
      expect(transcript(session)).toEqual([['user', 'Question'], ['assistant', 'Done']]);
      await session.dispose();
    });

    it('reports the status a spec scripts for a run', async () => {
      const t = new MockAgentTransport();
      const signal = new AbortController().signal;
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: t });
      const turn = session.submit('Question');
      await t.flush();
      await expect(t.getRunStatus('t', 'mock-run-1', signal)).resolves.toBe('running');
      t.runs[0].status = 'timeout';
      await t.close();
      await expect(turn).resolves.toBe('error');
      expect(t.runs[0].status).toBe('timeout');
      await expect(t.getRunStatus('t', 'nope', signal)).rejects.toThrow(/started no run/);
      await session.dispose();
    });

    it('loads the history a spec sets', async () => {
      const t = new MockAgentTransport();
      t.history = [
        {
          values: { messages: [{ id: 'u1', type: 'human', content: 'Saved question' }, { id: 'a1', type: 'ai', content: 'Saved answer' }] },
          next: [],
          tasks: [],
          metadata: {},
          checkpoint: { thread_id: 't', checkpoint_ns: '', checkpoint_id: 'c1', checkpoint_map: {} },
          parent_checkpoint: null,
          created_at: '2026-11-19T00:00:00Z',
        } as never,
      ];
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: t });
      await session.load?.();
      expect(transcript(session)).toEqual([['user', 'Saved question'], ['assistant', 'Saved answer']]);
      expect(t.historyCalls).toEqual(['t']);
      await session.dispose();
    });

    it('drops what a stopped run left unread, so the next run starts clean', async () => {
      const t = new MockAgentTransport();
      const session = createSession({ assistantId: 'agent', threadId: 't', transport: t });
      const turn = session.submit('One');
      await t.flush();
      await session.stop();
      await expect(turn).resolves.toBe('aborted');
      expect(t.runs[0].status).toBe('interrupted');

      const next = session.submit('Two');
      await t.flush();
      expect(t.isStreaming()).toBe(true);
      await t.emit([saved([...sent(t, 1), { id: 'a2', type: 'ai', content: 'Answer' }])]);
      await t.close();
      await expect(next).resolves.toBe('success');
      await session.dispose();
    });
  });

  it('emitError() causes stream to throw', async () => {
    const t = new MockAgentTransport();
    const ac = new AbortController();
    const iter = t.stream('agent', null, {}, ac.signal);
    t.emitError(new Error('transport error'));
    await expect(async () => {
      for await (const _ of iter) { /* noop */ }
    }).rejects.toThrow('transport error');
  });
});
