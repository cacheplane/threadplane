import { describe, it, expect } from 'vitest';
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
