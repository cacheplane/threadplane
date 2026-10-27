import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbstractAgent, EventType, type BaseEvent, type Message as AgUiMessage, type RunAgentInput } from '@ag-ui/client';
import { Subject, type Observable } from 'rxjs';
import type { Message } from '@threadplane/chat';
import { FakeAgent, type FakeAgentScript } from './testing/fake-agent';
import { toAgent } from './to-agent';
import type { AgUiInterruptPersistence, AgUiThreadRecord } from './interrupt-persistence';

/** A FakeAgent that records every run's validated input. */
class RecordingAgent extends FakeAgent {
  readonly inputs: RunAgentInput[] = [];
  override run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(structuredClone(input));
    return super.run(input);
  }
}

/** A server that streams tool calls without a parent message, then answers. */
const toolOnlyPhase: FakeAgentScript = [{
  when: 'initial',
  events: [
    { type: EventType.TOOL_CALL_START, toolCallId: 'call-weather', toolCallName: 'get_weather' },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call-weather', delta: '{"station":"KPAO"}' },
    { type: EventType.TOOL_CALL_END, toolCallId: 'call-weather' },
    { type: EventType.SUBAGENT_STARTED, subagentRunId: 'child-1', name: 'performance', parentToolCallId: 'call-weather' },
    { type: EventType.SUBAGENT_FINISHED, subagentRunId: 'child-1' },
    { type: EventType.TOOL_CALL_RESULT, messageId: 'result-weather', toolCallId: 'call-weather', content: '{"wind":"calm"}' },
    { type: EventType.TOOL_CALL_START, toolCallId: 'call-route', toolCallName: 'plan_route' },
    { type: EventType.TOOL_CALL_END, toolCallId: 'call-route' },
    { type: EventType.TEXT_MESSAGE_START, messageId: 'answer', role: 'assistant' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'answer', delta: 'Route planned.' },
    { type: EventType.TEXT_MESSAGE_END, messageId: 'answer' },
  ] as BaseEvent[],
}];

/** Assistant messages as id/content/tool-call-id triples. */
function localAssistants(messages: readonly Message[]) {
  return messages.filter(m => m.role === 'assistant')
    .map(m => ({ id: m.id, content: m.content, toolCallIds: m.toolCallIds ?? [] }));
}
function sourceAssistants(messages: readonly AgUiMessage[]) {
  return messages.filter(m => m.role === 'assistant').map(m => {
    const assistant = m as { id: string; content?: unknown; toolCalls?: Array<{ id: string }> };
    return { id: assistant.id, content: assistant.content ?? '', toolCallIds: (assistant.toolCalls ?? []).map(c => c.id) };
  });
}

afterEach(() => vi.restoreAllMocks());

describe('toAgent with a server that streams tool calls without a parent message', () => {
  it('renders the tool-only phase as assistant messages that list their calls', async () => {
    const source = new RecordingAgent({ delayMs: 0, script: toolOnlyPhase });
    const agent = toAgent(source);
    await agent.submit({ message: 'Plan a flight' });

    expect(localAssistants(agent.messages())).toEqual([
      { id: 'call-weather', content: '', toolCallIds: ['call-weather'] },
      { id: 'call-route', content: '', toolCallIds: ['call-route'] },
      { id: 'answer', content: 'Route planned.', toolCallIds: [] },
    ]);
    // Every listed id resolves to a tool call, as per-message rendering needs.
    const byId = new Map(agent.toolCalls().map(call => [call.id, call]));
    expect(byId.get('call-weather')).toMatchObject({
      name: 'get_weather', args: { station: 'KPAO' }, status: 'complete', result: { wind: 'calm' },
    });
    expect(byId.get('call-route')).toMatchObject({ name: 'plan_route', status: 'complete' });
    // The subagent anchors to a call that a message lists.
    const [subagent] = [...agent.subagents().values()];
    expect(subagent.toolCallId).toBe('call-weather');
    expect(agent.messages().some(m => m.toolCallIds?.includes(subagent.toolCallId))).toBe(true);
    agent.dispose();
  });

  it('shows the tool call while the tool-only phase is still running', async () => {
    const stream = new Subject<BaseEvent>();
    let runId = '';
    class ManualAgent extends AbstractAgent {
      run(input: RunAgentInput): Observable<BaseEvent> { runId = input.runId; return stream; }
    }
    const agent = toAgent(new ManualAgent());
    const run = agent.submit({ message: 'go' });
    await vi.waitFor(() => expect(stream.observed).toBe(true));
    stream.next({ type: EventType.RUN_STARTED, threadId: 't', runId } as BaseEvent);
    stream.next({ type: EventType.TOOL_CALL_START, toolCallId: 'call-1', toolCallName: 'slow_tool' } as BaseEvent);
    await vi.waitFor(() => expect(localAssistants(agent.messages())).toEqual([
      { id: 'call-1', content: '', toolCallIds: ['call-1'] },
    ]));
    expect(agent.isLoading()).toBe(true);
    expect(agent.messages().at(-1)?.delivery.phase).toBe('streaming');
    stream.next({ type: EventType.RUN_FINISHED, threadId: 't', runId } as BaseEvent);
    stream.complete();
    await run;
    expect(agent.messages().at(-1)?.delivery.phase).toBe('complete');
    agent.dispose();
  });

  it('builds the same assistant messages the source agent holds, so a replayed thread matches', async () => {
    const source = new RecordingAgent({ delayMs: 0, script: toolOnlyPhase });
    const agent = toAgent(source);
    await agent.submit({ message: 'Plan a flight' });
    expect(localAssistants(agent.messages())).toEqual(sourceAssistants(source.messages));
    agent.dispose();
  });

  it('hydrates a persisted thread into the same assistant messages', async () => {
    const records = new Map<string, AgUiThreadRecord>();
    const persistence: AgUiInterruptPersistence = {
      namespace: 'account/agent',
      store: {
        async load(key) { return structuredClone(records.get(key) ?? null); },
        async compareAndSwap(key, revision, record) {
          if ((records.get(key)?.revision ?? null) !== revision) return false;
          records.set(key, structuredClone(record));
          return true;
        },
      },
    };
    const live = new FakeAgent({ delayMs: 0, script: toolOnlyPhase });
    live.threadId = 'thread-1';
    const first = toAgent(live, { persistence, telemetry: false });
    await first.ready;
    await first.submit({ message: 'Plan a flight' });
    const rendered = localAssistants(first.messages());
    first.dispose();

    const restored = new FakeAgent({ delayMs: 0 });
    restored.threadId = 'thread-1';
    const second = toAgent(restored, { persistence, telemetry: false });
    await second.ready;
    expect(localAssistants(second.messages())).toEqual(rendered);
    expect(second.toolCalls().map(call => call.id)).toEqual(['call-weather', 'call-route']);
    second.dispose();
  });

  it('sends no local-only message fields in the run input', async () => {
    const warn = vi.spyOn(console, 'warn');
    const source = new RecordingAgent({ delayMs: 0, script: toolOnlyPhase });
    const agent = toAgent(source);
    await agent.submit({ message: 'Plan a flight' });
    await agent.regenerate(agent.messages().findIndex(m => m.id === 'answer'));

    expect(source.inputs).toHaveLength(2);
    for (const input of source.inputs) {
      for (const message of input.messages) {
        expect(Object.keys(message)).not.toContain('delivery');
        expect(Object.keys(message)).not.toContain('toolCallIds');
      }
    }
    expect(source.inputs[0].messages).toEqual([{ id: expect.any(String), role: 'user', content: 'Plan a flight' }]);
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/unrecognised/i);
    agent.dispose();
  });
});
