import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbstractAgent, BaseEvent } from '@ag-ui/client';
import { toAgent } from './to-agent';

type Subscriber = Parameters<AbstractAgent['subscribe']>[0];

/** Holds real adapter subscriber callbacks while a source run remains in flight. */
class ReasoningSource {
  state = {};
  subscriber!: Subscriber;
  release!: () => void;
  callbackCount = 0;
  subscribe(subscriber: Subscriber) {
    this.subscriber = subscriber;
    return { unsubscribe: () => undefined };
  }
  runAgent() {
    return new Promise(resolve => {
      this.release = () => resolve({ result: undefined, newMessages: [] });
    });
  }
  abortRun() { /* The test releases transport completion independently. */ }
  emit(type: string, runId = 'current', messageId = 'shared') {
    this.callbackCount++;
    this.subscriber.onEvent?.({
      event: { type, runId, messageId, delta: 'thinking' } as BaseEvent,
      input: { runId: 'current' },
    } as Parameters<NonNullable<Subscriber['onEvent']>>[0]);
  }
}

describe('toAgent reasoning ownership through source callbacks', () => {
  let now = 100;
  const agents: ReturnType<typeof toAgent>[] = [];
  beforeEach(() => {
    now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    for (const agent of agents.splice(0)) agent.dispose();
    vi.restoreAllMocks();
  });

  function begin() {
    const source = new ReasoningSource();
    const agent = toAgent(source as unknown as AbstractAgent, { telemetry: false });
    agents.push(agent);
    const completion = agent.submit({});
    source.emit('RUN_STARTED');
    return { source, agent, completion };
  }

  it('isolates simultaneous instances with equal IDs and consumes END once', async () => {
    const first = begin();
    const second = begin();
    first.source.emit('REASONING_MESSAGE_START');
    now = 200;
    second.source.emit('REASONING_MESSAGE_START');
    now = 300;
    first.source.emit('REASONING_MESSAGE_END');
    expect(first.agent.messages()[0].reasoningDurationMs).toBe(200);
    const messages = first.agent.messages();
    now = 450;
    first.source.emit('REASONING_MESSAGE_END');
    expect(first.agent.messages()).toBe(messages);
    second.source.emit('REASONING_MESSAGE_END');
    expect(second.agent.messages()[0].reasoningDurationMs).toBe(250);
    expect(first.source.callbackCount).toBe(4);
    expect(second.source.callbackCount).toBe(3);
    first.source.emit('RUN_FINISHED');
    second.source.emit('RUN_FINISHED');
    first.source.release();
    second.source.release();
    await Promise.all([first.completion, second.completion]);
  });

  it.each(['stop', 'dispose'] as const)('keeps late callbacks inert after %s and does not leak a same-ID start', async operation => {
    const previous = begin();
    previous.source.emit('REASONING_MESSAGE_START');
    if (operation === 'stop') await previous.agent.stop();
    else previous.agent.dispose();
    const messages = previous.agent.messages();
    const current = begin();
    current.source.emit('TEXT_MESSAGE_START');
    const currentMessages = current.agent.messages();
    now = 300;
    previous.source.emit('REASONING_MESSAGE_END');
    current.source.emit('REASONING_MESSAGE_END');
    expect(previous.agent.messages()).toBe(messages);
    expect(current.agent.messages()).toBe(currentMessages);
    expect(currentMessages[0].reasoningDurationMs).toBeUndefined();
    expect(previous.source.callbackCount).toBe(3);
    current.source.emit('REASONING_MESSAGE_START');
    now = 400;
    current.source.emit('REASONING_MESSAGE_END');
    expect(current.agent.messages()[0].reasoningDurationMs).toBe(100);
    current.source.emit('RUN_FINISHED');
    previous.source.release();
    current.source.release();
    await Promise.all([previous.completion, current.completion]);
  });

  it.each(['START', 'CONTENT', 'CHUNK', 'END'])(
    'rejects a foreign %s body even when the callback envelope identifies the current run', async type => {
      const { source, agent, completion } = begin();
      source.emit('REASONING_MESSAGE_START');
      const messages = agent.messages();
      now = 200;
      source.emit(`REASONING_MESSAGE_${type}`, 'foreign');
      expect(agent.messages()).toBe(messages);
      now = 300;
      source.emit('REASONING_MESSAGE_END');
      expect(agent.messages()[0].reasoningDurationMs).toBe(200);
      expect(source.callbackCount).toBe(4);
      source.emit('RUN_FINISHED');
      source.release();
      await completion;
    },
  );
});
