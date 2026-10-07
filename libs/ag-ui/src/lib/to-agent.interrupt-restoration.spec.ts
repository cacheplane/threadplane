import { it, expect, vi } from 'vitest';
import { HttpAgent } from '@ag-ui/client';
import { toAgent } from './to-agent';
import type { AgUiInterruptPersistence, AgUiThreadRecord } from './interrupt-persistence';

function memory() {
  const records = new Map<string, AgUiThreadRecord>();
  const config: AgUiInterruptPersistence = {
    namespace: 'account/agent',
    store: {
      async load(key) { return structuredClone(records.get(key) ?? null); },
      async compareAndSwap(key, revision, record) {
        if ((records.get(key)?.revision ?? null) !== revision) return false;
        records.set(key, structuredClone(record)); return true;
      },
    },
  };
  return { config, records };
}

function source() {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body));
    const events = [
      { type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId },
      { type: 'STATE_SNAPSHOT', snapshot: { amount: 12 } },
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'Approve this' }] },
      { type: 'RUN_FINISHED', runId: input.runId, threadId: input.threadId, outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'confirmation' }, { id: 'i2', reason: 'confirmation' }] } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  });
  return { source: new HttpAgent({ url: 'http://test.invalid', threadId: 't1', fetch }), fetch };
}

it('blocks the composer until asynchronous hydration completes', async () => {
  const { config } = memory();
  let release!: () => void;
  config.store.load = async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return null;
  };
  const agent = toAgent(source().source, { persistence: config, telemetry: false });
  expect(agent.isInputBlocked?.()).toBe(true);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  release(); await agent.ready;
  expect(agent.isInputBlocked?.()).toBe(false);
  agent.dispose();
});

it('restores committed messages, state and a complete batch into a new adapter', async () => {
  const { config } = memory();
  const original = source();
  const first = toAgent(original.source, { persistence: config, telemetry: false });
  await first.ready;
  await first.submit({ message: 'Approve this' });
  first.dispose();
  const replacement = source();
  const second = toAgent(replacement.source, { persistence: config, telemetry: false });
  await second.ready;
  expect(second.state()).toEqual({ amount: 12 });
  expect(second.messages().map(message => message.content)).toEqual(['Approve this']);
  expect(second.interruptSession().interrupts.map(entry => entry.id)).toEqual(['i1', 'i2']);
  expect(replacement.source.pendingInterrupts).toHaveLength(2);
  expect(replacement.fetch).not.toHaveBeenCalled();
  second.dispose();
});

it('restores tool identity and accepts a resumed result followed by a new interrupt batch', async () => {
  const { config } = memory();
  const initial = source();
  initial.fetch.mockImplementationOnce(async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    const events = [
      { type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId },
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'assistant-1', role: 'assistant', content: '', toolCalls: [{ id: 'tool-1', type: 'function', function: { name: 'approve', arguments: '{}' } }] }] },
      { type: 'RUN_FINISHED', runId: input.runId, threadId: input.threadId, outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'confirmation' }] } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  });
  const first = toAgent(initial.source, { persistence: config, telemetry: false });
  await first.ready; await first.submit({}); first.dispose();
  const replacement = source();
  replacement.fetch.mockImplementationOnce(async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    const events = [
      { type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'tool-1', messageId: 'result-1', role: 'tool', content: '{"approved":true}' },
      { type: 'STATE_SNAPSHOT', snapshot: { approved: true } },
      { type: 'RUN_FINISHED', runId: input.runId, threadId: input.threadId, outcome: { type: 'interrupt', interrupts: [{ id: 'next', reason: 'confirmation' }] } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  });
  const second = toAgent(replacement.source, { persistence: config, telemetry: false });
  await second.ready;
  const generation = second.interruptSession().generation;
  expect(second.toolCalls()?.map(tool => tool.id)).toEqual(['tool-1']);
  await second.submit({ resume: true });
  expect(second.error()).toBeUndefined();
  expect(second.toolCalls()?.find(tool => tool.id === 'tool-1')?.result).toEqual({ approved: true });
  expect(second.interruptSession().generation).toBe(generation + 1);
  expect(second.interruptSession().interrupts.map(entry => entry.id)).toEqual(['next']);
  expect(second.state()).toEqual({ approved: true });
  second.dispose();
});

it('prevents a second restored instance from dispatching a conflicting claim', async () => {
  const { config } = memory();
  const first = toAgent(source().source, { persistence: config, telemetry: false });
  await first.ready; await first.submit({});
  const otherSource = source();
  const second = toAgent(otherSource.source, { persistence: config, telemetry: false });
  await second.ready;
  const responses = ['i1', 'i2'].map(interruptId => ({ interruptId, status: 'resolved', payload: true }));
  await first.submit({ resume: responses });
  await second.submit({ resume: responses });
  expect(otherSource.fetch).not.toHaveBeenCalled();
  expect(second.error()).toBeDefined();
  first.dispose(); second.dispose();
});

it('blocks decisions while authoritative reconciliation is in progress', async () => {
  const { config } = memory();
  let release!: () => void;
  config.reconcile = async record => {
    await new Promise<void>(resolve => { release = resolve; });
    return { status: 'pending', committed: record.committed, session: record.session };
  };
  const original = source();
  const agent = toAgent(original.source, { persistence: config, telemetry: false });
  await agent.ready; await agent.submit({});
  const recovery = agent.reconcileInterrupt();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const resume = ['i1', 'i2'].map(interruptId => ({ interruptId, status: 'resolved', payload: true }));
  await expect(agent.submit({ resume })).rejects.toThrow(/reconcil|recovery/);
  expect(original.fetch).toHaveBeenCalledTimes(1);
  release(); await recovery;
  agent.dispose();
});

it('requires reconciliation after a lost acknowledgement and replays the exact saved decision', async () => {
  const { config } = memory();
  config.reconcile = async record => ({ status: 'pending', committed: record.committed, session: { ...record.session, phase: 'pending' } });
  const original = source();
  const first = toAgent(original.source, { persistence: config, telemetry: false });
  await first.ready; await first.submit({});
  original.fetch.mockRejectedValueOnce(new Error('lost acknowledgement'));
  const resume = ['i1', 'i2'].map(interruptId => ({ interruptId, status: 'resolved', payload: { approved: true } }));
  await first.submit({ resume, state: { reviewer: 'Ada' } });
  const failedRequest = JSON.parse(String(original.fetch.mock.calls[1][1]?.body));
  first.dispose();
  const replacement = source();
  const second = toAgent(replacement.source, { persistence: config, telemetry: false });
  await second.ready;
  expect(second.interruptSession().phase).toBe('uncertain');
  await expect(second.retry()).rejects.toThrow(/reconcil/);
  expect(replacement.fetch).not.toHaveBeenCalled();
  await second.reconcileInterrupt();
  await second.retry();
  const replay = JSON.parse(String(replacement.fetch.mock.calls[0][1]?.body));
  expect(replay.resume).toEqual(failedRequest.resume);
  expect(replay.state).toEqual(failedRequest.state);
  expect(replay.messages).toEqual(failedRequest.messages);
  expect(replay.runId).toBe(failedRequest.runId);
  second.dispose();
});

it('taps the live run on rawEvents$ but emits nothing for hydration, which restores a snapshot', async () => {
  const { config } = memory();
  const first = toAgent(source().source, { persistence: config, telemetry: false });
  const live: string[] = [];
  first.rawEvents$.subscribe(event => live.push(event.type));
  await first.ready;
  await first.submit({ message: 'Approve this' });
  first.dispose();
  expect(live).toEqual(['RUN_STARTED', 'STATE_SNAPSHOT', 'MESSAGES_SNAPSHOT', 'RUN_FINISHED']);

  const second = toAgent(source().source, { persistence: config, telemetry: false });
  const replayed: string[] = [];
  second.rawEvents$.subscribe(event => replayed.push(event.type));
  await second.ready;
  expect(second.state()).toEqual({ amount: 12 });
  expect(replayed).toEqual([]);
  second.dispose();
});
