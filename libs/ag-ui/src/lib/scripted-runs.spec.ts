import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpAgent, type BaseEvent, type RunAgentInput } from '@ag-ui/client';
import { Observable } from 'rxjs';
import { toAgent, type AgUiAgent } from './to-agent';

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
type ScriptEvent = { type: string; [key: string]: unknown };
type Global = typeof globalThis & { __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

let acks: Ack[] = [];
const collect = (event: Event) => acks.push((event as CustomEvent<Ack>).detail);
const armIds: string[] = [];

function arm(armId: string, runs: ScriptEvent[][]): void {
  armIds.push(armId);
  window.dispatchEvent(new CustomEvent('threadplane:devtools:arm', {
    detail: { v: 1, armId, adapter: 'ag-ui', runs: runs.map(events => ({ events })) },
  }));
}

/**
 * A real HttpAgent: anything that is not scripted goes to `fetch`, which the
 * tests replace with a spy that fails loudly. `runs` records every call that
 * reached the agent's own `run`.
 */
class RecordingHttpAgent extends HttpAgent {
  readonly runs: RunAgentInput[] = [];
  override run(input: RunAgentInput): Observable<BaseEvent> {
    this.runs.push(input);
    return super.run(input);
  }
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
function create(): { source: RecordingHttpAgent; agent: AgUiAgent } {
  const source = new RecordingHttpAgent({ url: 'http://127.0.0.1:1/agent', threadId: 'thread-1' });
  return { source, agent: toAgent(source, { telemetry: false }) };
}

const text = (agent: AgUiAgent) => agent.messages().map(m => m.content);

const INTERRUPT_RUNS: ScriptEvent[][] = [
  [
    { type: 'RUN_STARTED', threadId: 'captured-thread', runId: 'captured-run-1' },
    { type: 'TEXT_MESSAGE_START', messageId: 'ai-1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'ai-1', delta: 'This needs your approval.' },
    { type: 'TEXT_MESSAGE_END', messageId: 'ai-1' },
    {
      type: 'RUN_FINISHED', threadId: 'captured-thread', runId: 'captured-run-1',
      outcome: { type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'confirmation', message: 'Approve the $42 refund?' }] },
    },
  ],
  [
    { type: 'RUN_STARTED', threadId: 'captured-thread', runId: 'captured-run-2' },
    { type: 'TEXT_MESSAGE_START', messageId: 'ai-2', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'ai-2', delta: 'Refund issued.' },
    { type: 'TEXT_MESSAGE_END', messageId: 'ai-2' },
    { type: 'RUN_FINISHED', threadId: 'captured-thread', runId: 'captured-run-2', outcome: { type: 'success' } },
  ],
];

describe('scripted runs (AG-UI)', () => {
  beforeEach(() => {
    angular.devMode = true;
    acks = [];
    window.addEventListener('threadplane:devtools:ack', collect);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network used'));
  });
  afterEach(() => {
    for (const armId of armIds.splice(0)) {
      window.dispatchEvent(new CustomEvent('threadplane:devtools:disarm', { detail: { v: 1, armId } }));
    }
    window.removeEventListener('threadplane:devtools:ack', collect);
    fetchSpy.mockRestore();
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
  });

  it('pauses at a RUN_FINISHED interrupt outcome and completes on resume, with no network', async () => {
    const { source, agent } = create();
    arm('interrupt', INTERRUPT_RUNS);

    await agent.submit({ message: 'Refund order 42' });
    expect(agent.error()).toBeUndefined();
    expect(agent.interrupt!()).toBeDefined();
    expect(agent.interruptSession().phase).toBe('pending');
    expect(text(agent)).toEqual(['Refund order 42', 'This needs your approval.']);

    await agent.submit({ resume: { approved: true } });
    expect(agent.error()).toBeUndefined();
    expect(agent.interrupt!()).toBeUndefined();
    expect(agent.interruptSession().phase).toBe('none');
    expect(agent.status()).toBe('idle');
    expect(text(agent)).toEqual(['Refund order 42', 'This needs your approval.', 'Refund issued.']);

    expect(source.runs).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The agent's own run is back in place.
    expect(Object.prototype.hasOwnProperty.call(source, 'run')).toBe(false);
    expect(acks).toEqual([
      { v: 1, armId: 'interrupt', state: 'armed' },
      { v: 1, armId: 'interrupt', state: 'consumed', run: 0 },
      { v: 1, armId: 'interrupt', state: 'consumed', run: 1 },
    ]);
  });

  it('pauses at a legacy CUSTOM on_interrupt and completes on resume', async () => {
    const { source, agent } = create();
    arm('legacy', [
      [
        { type: 'RUN_STARTED' },
        { type: 'CUSTOM', name: 'on_interrupt', value: JSON.stringify({ question: 'Approve?' }) },
        { type: 'RUN_FINISHED' },
      ],
      [{ type: 'RUN_STARTED' }, { type: 'RUN_FINISHED' }],
    ]);
    await agent.submit({ message: 'go' });
    expect(agent.interrupt!()?.value).toEqual({ question: 'Approve?' });
    await agent.submit({ resume: true });
    expect(agent.interrupt!()).toBeUndefined();
    expect(agent.interruptSession().phase).toBe('none');
    expect(agent.error()).toBeUndefined();
    expect(source.runs).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hands off to a subagent', async () => {
    const { source, agent } = create();
    arm('handoff', [[
      { type: 'RUN_STARTED' },
      { type: 'TOOL_CALL_START', toolCallId: 'call_R', toolCallName: 'task', parentMessageId: 'ai-1' },
      { type: 'TOOL_CALL_END', toolCallId: 'call_R' },
      { type: 'SUBAGENT_STARTED', subagentRunId: 'sub-1', name: 'researcher', parentToolCallId: 'call_R' },
      { type: 'TEXT_MESSAGE_START', subagentRunId: 'sub-1', messageId: 'child-1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', subagentRunId: 'sub-1', messageId: 'child-1', delta: 'Order 42 shipped.' },
      { type: 'TEXT_MESSAGE_END', subagentRunId: 'sub-1', messageId: 'child-1' },
      { type: 'SUBAGENT_FINISHED', subagentRunId: 'sub-1', outcome: { type: 'success' } },
      { type: 'RUN_FINISHED' },
    ]]);
    await agent.submit({ message: 'Find order 42' });

    expect(agent.error()).toBeUndefined();
    const subagent = agent.subagents().get('sub-1');
    expect(subagent).toBeDefined();
    expect(subagent!.name).toBe('researcher');
    expect(subagent!.toolCallId).toBe('call_R');
    expect(subagent!.status()).toBe('complete');
    expect(subagent!.messages().map(m => m.content)).toEqual(['Order 42 shipped.']);
    expect(source.runs).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('surfaces a malformed event exactly as one from the agent itself', async () => {
    const malformed: ScriptEvent[] = [
      { type: 'RUN_STARTED' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-started', delta: 42 },
      { type: 'RUN_FINISHED' },
    ];
    const snapshot = (agent: AgUiAgent) => ({
      status: agent.status(),
      messages: agent.messages().map(m => [m.role, m.content]),
      error: agent.error() ? { kind: agent.error()!.kind, message: agent.error()!.message } : undefined,
    });

    // Control: the same events from the agent's own run.
    class Emitting extends HttpAgent {
      override run(input: RunAgentInput): Observable<BaseEvent> {
        return new Observable<BaseEvent>(subscriber => {
          for (const event of malformed) {
            subscriber.next((event.type.startsWith('RUN_')
              ? { ...event, threadId: input.threadId, runId: input.runId }
              : event) as unknown as BaseEvent);
          }
          subscriber.complete();
        });
      }
    }
    const control = toAgent(new Emitting({ url: 'http://127.0.0.1:1/agent', threadId: 'thread-1' }), { telemetry: false });
    await control.submit({ message: 'go' });

    const { source, agent } = create();
    arm('malformed', [malformed]);
    await agent.submit({ message: 'go' });

    expect(snapshot(agent)).toEqual(snapshot(control));
    expect(agent.status()).toBe('error');
    expect(source.runs).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(acks.map(a => a.state)).toEqual(['armed', 'consumed']);
  });

  it('serves the replacing arm and goes to the network once disarmed', async () => {
    const { source, agent } = create();
    arm('first', INTERRUPT_RUNS);
    arm('second', [INTERRUPT_RUNS[1]]);
    await agent.submit({ message: 'hi' });
    expect(agent.interrupt!()).toBeUndefined();
    expect(text(agent)).toEqual(['hi', 'Refund issued.']);

    arm('third', INTERRUPT_RUNS);
    window.dispatchEvent(new CustomEvent('threadplane:devtools:disarm', { detail: { v: 1, armId: 'third' } }));
    await agent.submit({ message: 'again' });
    expect(source.runs).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(agent.status()).toBe('error');

    expect(acks).toEqual([
      { v: 1, armId: 'first', state: 'armed' },
      { v: 1, armId: 'first', state: 'disarmed' },
      { v: 1, armId: 'second', state: 'armed' },
      { v: 1, armId: 'second', state: 'consumed', run: 0 },
      { v: 1, armId: 'third', state: 'armed' },
      { v: 1, armId: 'third', state: 'disarmed' },
    ]);
  });

  it('rejects a LangGraph-shaped arm for AG-UI', async () => {
    const { source, agent } = create();
    window.dispatchEvent(new CustomEvent('threadplane:devtools:arm', {
      detail: { v: 1, armId: 'wrong-shape', adapter: 'ag-ui', runs: [{ frames: [{ event: 'values', data: {} }] }] },
    }));
    await agent.submit({ message: 'hi' });
    expect(source.runs).toHaveLength(1);
    expect(acks).toEqual([{ v: 1, armId: 'wrong-shape', state: 'rejected', reason: 'run 0 has no events list' }]);
  });

  it('is not armable when the page opted out', async () => {
    (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    const { source, agent } = create();
    arm('opted-out', INTERRUPT_RUNS);
    await agent.submit({ message: 'hi' });
    expect(source.runs).toHaveLength(1);
    expect(acks).toEqual([]);
  });
});
