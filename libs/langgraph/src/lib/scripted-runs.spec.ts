import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { agent } from './agent.fn';
import { MockAgentTransport } from './transport/mock-stream.transport';
import { normalizeSdkEvent } from './transport/fetch-stream.transport';
import type { AgentTransport, StreamEvent } from './agent.types';

const angular = vi.hoisted(() => ({ devMode: true }));
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDevMode: () => angular.devMode,
}));

/** The ack contract the AG-UI DevTools extension validates. */
interface Ack {
  v: 1;
  armId: string;
  state: 'armed' | 'consumed' | 'expired' | 'disarmed' | 'rejected';
  run?: number;
  reason?: string;
}
type Frame = { event: string; data: unknown };
type Global = typeof globalThis & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

let acks: Ack[] = [];
const collect = (event: Event) => acks.push((event as CustomEvent<Ack>).detail);
const armIds: string[] = [];

function arm(armId: string, runs: Frame[][]): void {
  armIds.push(armId);
  window.dispatchEvent(new CustomEvent('threadplane:devtools:arm', {
    detail: { v: 1, armId, adapter: 'langgraph', runs: runs.map(frames => ({ frames })) },
  }));
}

function create(transport: AgentTransport = new MockAgentTransport(), extra: Record<string, unknown> = {}) {
  let ref!: ReturnType<typeof agent>;
  TestBed.runInInjectionContext(() => {
    ref = agent({ assistantId: 'test', transport, throttle: 0, ...extra });
  });
  return ref;
}

const text = (message: unknown) => (message as { content?: unknown }).content;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// A human-in-the-loop turn: the model asks to call a tool, the graph pauses
// with interrupt(), and the resumed run executes the tool and answers.
const REQUEST = { id: 'h-1', type: 'human', content: 'Refund order 42' };
const ASK = {
  id: 'ai-1', type: 'ai', content: 'This needs your approval.',
  tool_calls: [{ id: 'call_refund', name: 'issue_refund', args: { order: 42 } }],
};
const INTERRUPT_RUNS: Frame[][] = [
  [
    { event: 'metadata', data: { run_id: 'scripted-1' } },
    {
      event: 'values',
      data: {
        messages: [REQUEST, ASK],
        __interrupt__: [{ id: 'int-1', value: { question: 'Approve the $42 refund?' } }],
      },
    },
  ],
  [
    {
      event: 'values',
      data: {
        messages: [
          REQUEST,
          ASK,
          { id: 't-1', type: 'tool', tool_call_id: 'call_refund', name: 'issue_refund', content: 'refunded' },
          { id: 'ai-2', type: 'ai', content: 'Refund issued.' },
        ],
      },
    },
  ],
];

describe('scripted runs (LangGraph)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    angular.devMode = true;
    acks = [];
    window.addEventListener('threadplane:devtools:ack', collect);
  });
  afterEach(() => {
    // Leave no pending arm for the next test.
    for (const armId of armIds.splice(0)) {
      window.dispatchEvent(new CustomEvent('threadplane:devtools:disarm', { detail: { v: 1, armId } }));
    }
    window.removeEventListener('threadplane:devtools:ack', collect);
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
  });

  it('pauses at a scripted interrupt and completes on resume, with no stream or history call', async () => {
    const transport = new MockAgentTransport();
    const ref = create(transport, { threadId: 'thread-1' });
    await settle();
    const historyBefore = transport.historyCalls.length;
    arm('interrupt', INTERRUPT_RUNS);

    await ref.submit({ message: 'Refund order 42' });

    await settle();
    expect(ref.interrupt!()?.value).toEqual({ question: 'Approve the $42 refund?' });
    expect(ref.status()).not.toBe('error');
    expect(ref.messages().map(text)).toEqual(['Refund order 42', 'This needs your approval.']);

    await ref.submit({ resume: { approved: true } });

    await settle();
    expect(ref.interrupt!()).toBeUndefined();
    expect(ref.error()).toBeUndefined();
    expect(ref.status()).toBe('idle');
    expect(ref.messages().map(text)).toEqual(['Refund order 42', 'This needs your approval.', 'refunded', 'Refund issued.']);

    expect(transport.streams).toHaveLength(0);
    expect(transport.historyCalls).toHaveLength(historyBefore);
    expect(acks).toEqual([
      { v: 1, armId: 'interrupt', state: 'armed' },
      { v: 1, armId: 'interrupt', state: 'consumed', run: 0 },
      { v: 1, armId: 'interrupt', state: 'consumed', run: 1 },
    ]);

    // Fully consumed: the next submit goes to the transport again.
    const next = ref.submit({ message: 'again' });
    await transport.flush();
    expect(transport.streams).toHaveLength(1);
    await transport.close();
    await next;
  });

  it('never touches the network with the default transport', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network used'));
    try {
      let ref!: ReturnType<typeof agent>;
      TestBed.runInInjectionContext(() => {
        ref = agent({ apiUrl: 'http://127.0.0.1:1', assistantId: 'test', throttle: 0 });
      });
      arm('offline', INTERRUPT_RUNS);
      await ref.submit({ message: 'Refund order 42' });
      await settle();
      await ref.submit({ resume: { approved: true } });
      await settle();
      expect(ref.messages().map(text)).toContain('Refund issued.');
      expect(ref.error()).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('hands off to a subagent through the threadplane.subagent_binding custom event', async () => {
    const transport = new MockAgentTransport();
    const ref = create(transport, { subagentToolNames: ['task'] });
    const dispatch = {
      id: 'ai-1', type: 'ai', content: '',
      tool_calls: [{ id: 'call_R', name: 'task', args: { subagent_type: 'researcher', description: 'Find the order' } }],
    };
    arm('handoff', [[
      { event: 'values', data: { messages: [{ id: 'h-1', type: 'human', content: 'Find order 42' }, dispatch] } },
      { event: 'custom', data: { type: 'threadplane.subagent_binding', namespace: 'tools:ns-R', tool_call_id: 'call_R' } },
      { event: 'messages|tools:ns-R', data: [{ id: 'm-r', type: 'AIMessageChunk', content: 'Order 42 shipped.' }, { checkpoint_ns: 'tools:ns-R' }] },
      { event: 'updates|tools:ns-R', data: { model: { step: 1 } } },
      {
        event: 'values',
        data: {
          messages: [
            { id: 'h-1', type: 'human', content: 'Find order 42' },
            dispatch,
            { id: 't-1', type: 'tool', tool_call_id: 'call_R', name: 'task', content: 'Order 42 shipped.' },
            { id: 'ai-2', type: 'ai', content: 'It shipped.' },
          ],
        },
      },
    ]]);

    await ref.submit({ message: 'Find order 42' });

    await settle();

    const subagent = ref.subagents!().get('call_R');
    expect(subagent).toBeDefined();
    expect(subagent!.messages().map(text)).toEqual(['Order 42 shipped.']);
    // The binding is protocol chatter, consumed rather than surfaced.
    expect(ref.customEvents()).toEqual([]);
    expect(transport.streams).toHaveLength(0);
    expect(acks.map(a => a.state)).toEqual(['armed', 'consumed']);
  });

  it('surfaces a malformed frame exactly as a transport-delivered one', async () => {
    const malformed: Frame[] = [
      { event: 'values', data: { messages: 'not a list', topic: 7 } },
      { event: 'messages', data: { not: 'a tuple' } },
      { event: 'updates', data: 'not an object' },
      { event: 'error', data: { error: 'BadPayload', message: 'Scripted failure' } },
    ];
    const snapshot = (ref: ReturnType<typeof agent>) => ({
      status: ref.status(),
      messages: ref.messages().map(m => [m.role, m.content]),
      error: ref.error() ? { kind: ref.error()!.kind, message: ref.error()!.message } : undefined,
      state: ref.state?.(),
    });

    // Control: the same frames through a transport, normalized as FetchStreamTransport does.
    const frames: AgentTransport = {
      async *stream() {
        for (const frame of malformed) yield normalizeSdkEvent(frame.event as StreamEvent['type'], frame.data);
      },
    };
    const control = create(frames);
    await control.submit({ message: 'go' });
    await settle();

    const transport = new MockAgentTransport();
    const scripted = create(transport);
    arm('malformed', [malformed]);
    await scripted.submit({ message: 'go' });
    await settle();

    expect(snapshot(scripted)).toEqual(snapshot(control));
    expect(scripted.status()).toBe('error');
    expect(transport.streams).toHaveLength(0);
    expect(acks.map(a => a.state)).toEqual(['armed', 'consumed']);
  });

  it('streams from the transport again once an arm is disarmed', async () => {
    const transport = new MockAgentTransport();
    const ref = create(transport);
    arm('cancel-me', INTERRUPT_RUNS);
    window.dispatchEvent(new CustomEvent('threadplane:devtools:disarm', { detail: { v: 1, armId: 'cancel-me' } }));
    const run = ref.submit({ message: 'hi' });
    await transport.flush();
    expect(transport.streams).toHaveLength(1);
    await transport.close();
    await run;
    expect(acks.map(a => a.state)).toEqual(['armed', 'disarmed']);
  });

  it('serves the replacing arm, not the replaced one', async () => {
    const transport = new MockAgentTransport();
    const ref = create(transport);
    arm('first', INTERRUPT_RUNS);
    arm('second', [INTERRUPT_RUNS[1]]);
    await ref.submit({ message: 'hi' });
    await settle();
    expect(ref.interrupt!()).toBeUndefined();
    expect(ref.messages().map(text)).toContain('Refund issued.');
    expect(acks).toEqual([
      { v: 1, armId: 'first', state: 'armed' },
      { v: 1, armId: 'first', state: 'disarmed' },
      { v: 1, armId: 'second', state: 'armed' },
      { v: 1, armId: 'second', state: 'consumed', run: 0 },
    ]);
    expect(transport.streams).toHaveLength(0);
  });

  it('rejects an AG-UI-shaped arm for LangGraph and keeps using the transport', async () => {
    const transport = new MockAgentTransport();
    const ref = create(transport);
    window.dispatchEvent(new CustomEvent('threadplane:devtools:arm', {
      detail: { v: 1, armId: 'wrong-shape', adapter: 'langgraph', runs: [{ events: [{ type: 'RUN_STARTED' }] }] },
    }));
    const run = ref.submit({ message: 'hi' });
    await transport.flush();
    expect(transport.streams).toHaveLength(1);
    await transport.close();
    await run;
    expect(acks).toEqual([{ v: 1, armId: 'wrong-shape', state: 'rejected', reason: 'run 0 has no frames list' }]);
  });

  it('is not served to an agent created outside development mode', async () => {
    angular.devMode = false;
    const transport = new MockAgentTransport();
    const ref = create(transport);
    angular.devMode = true;
    arm('prod-agent', INTERRUPT_RUNS);
    const run = ref.submit({ message: 'hi' });
    await transport.flush();
    expect(transport.streams).toHaveLength(1);
    await transport.close();
    await run;
    // The page's listeners (from development agents) still answer; this agent never asks.
    expect(acks.map(a => a.state)).toEqual(['armed']);
  });

  it('is not armable when the page opted out', async () => {
    (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    const transport = new MockAgentTransport();
    const ref = create(transport);
    arm('opted-out', INTERRUPT_RUNS);
    const run = ref.submit({ message: 'hi' });
    await transport.flush();
    expect(transport.streams).toHaveLength(1);
    await transport.close();
    await run;
    expect(acks).toEqual([]);
  });
});
