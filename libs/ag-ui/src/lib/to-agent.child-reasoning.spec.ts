import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbstractAgent, BaseEvent } from '@ag-ui/client';
import { toAgent } from './to-agent';

type Subscriber = Parameters<AbstractAgent['subscribe']>[0];

/** Exercises the real adapter with controlled source subscriber callbacks. */
class ChildReasoningSource {
  state = {};
  subscriber!: Subscriber;
  release!: () => void;
  subscribe(subscriber: Subscriber) {
    this.subscriber = subscriber;
    return { unsubscribe: () => undefined };
  }
  runAgent() {
    return new Promise(resolve => {
      this.release = () => resolve({ result: undefined, newMessages: [] });
    });
  }
  abortRun() { /* Transport completion is released independently. */ }
  emit(type: string, fields: Record<string, unknown> = {}) {
    this.subscriber.onEvent?.({
      event: { type, runId: 'current', messageId: 'shared', ...fields } as BaseEvent,
      input: { runId: 'current' },
    } as Parameters<NonNullable<Subscriber['onEvent']>>[0]);
  }
  reason(type: string, fields: Record<string, unknown> = {}) {
    this.emit(`REASONING_MESSAGE_${type}`, { subagentRunId: 'child', ...fields });
  }
}

describe('toAgent child reasoning through source callbacks', () => {
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
    const source = new ChildReasoningSource();
    const agent = toAgent(source as unknown as AbstractAgent, { telemetry: false });
    agents.push(agent);
    const completion = agent.submit({});
    source.emit('RUN_STARTED');
    return { source, agent, completion };
  }

  it.each(['shared', 'different'])('projects child reasoning %s with stable wrappers and isolated parent/sibling messages', async messageId => {
    const { source, agent, completion } = begin();
    source.emit('REASONING_MESSAGE_START');
    source.emit('REASONING_MESSAGE_CONTENT', { delta: 'parent' });
    source.emit('SUBAGENT_STARTED', { subagentRunId: 'child', name: 'researcher' });
    source.emit('SUBAGENT_STARTED', { subagentRunId: 'sibling', name: 'reviewer' });
    source.reason('CONTENT', { subagentRunId: 'sibling', messageId, delta: 'sibling' });
    const parent = agent.messages();
    const tools = agent.toolCalls();
    const child = agent.subagents().get('child')!;
    const sibling = agent.subagents().get('sibling')!;
    const siblingMessages = sibling.messages();
    now = 200;
    source.reason('START', { messageId });
    source.reason('CONTENT', { messageId, delta: 'child\n' });
    source.reason('CHUNK', { messageId, delta: ' thought' });
    source.reason('END', { messageId });
    source.emit('TEXT_MESSAGE_START', { subagentRunId: 'child', messageId });
    source.emit('TEXT_MESSAGE_CONTENT', { subagentRunId: 'child', messageId, delta: 'answer' });
    source.emit('TOOL_CALL_START', { subagentRunId: 'child', parentMessageId: messageId, toolCallId: 'child-tool', toolCallName: 'lookup' });
    source.reason('START', { messageId });
    expect(agent.subagents().get('child')).toBe(child);
    expect(agent.subagents().get('sibling')).toBe(sibling);
    expect(sibling.messages()).toBe(siblingMessages);
    expect(siblingMessages).toMatchObject([{ id: messageId, reasoning: 'sibling', content: '' }]);
    expect(agent.messages()).toBe(parent);
    expect(agent.toolCalls()).toBe(tools);
    expect(agent.clientTools.pending()).toEqual([]);
    expect(child.messages()).toMatchObject([{ id: messageId, reasoning: 'child\n thought', content: 'answer', toolCallIds: ['child-tool'], delivery: { phase: 'streaming' } }]);
    expect(child.messages()).toHaveLength(1);
    expect(child.messages()[0].reasoningDurationMs).toBeUndefined();
    expect(child.status()).toBe('running');
    now = 400;
    source.emit('REASONING_MESSAGE_END');
    expect(agent.messages()[0].reasoningDurationMs).toBe(300);
    source.emit('RUN_FINISHED');
    source.release();
    await completion;
  });

  it('refreshes buffered child identity once and retains reasoning on re-announcement', async () => {
    const { source, agent, completion } = begin();
    source.reason('CHUNK', { delta: 'early' });
    const buffered = agent.subagents().get('child');
    expect(buffered?.messages()).toMatchObject([{ reasoning: 'early' }]);
    source.emit('SUBAGENT_STARTED', { subagentRunId: 'child', name: 'researcher', parentToolCallId: 'parent-tool' });
    const announced = agent.subagents().get('child')!;
    expect(announced).not.toBe(buffered);
    expect(announced.name).toBe('researcher');
    expect(announced.toolCallId).toBe('parent-tool');
    source.reason('CONTENT', { delta: ' later' });
    source.emit('SUBAGENT_STARTED', { subagentRunId: 'child', name: 'researcher', parentToolCallId: 'parent-tool' });
    expect(agent.subagents().get('child')).toBe(announced);
    expect(announced.messages()).toMatchObject([{ reasoning: 'early later' }]);
    expect(agent.messages()).toEqual([]);
    source.emit('RUN_FINISHED');
    source.release();
    await completion;
  });

  it.each(['settled', 'stop', 'dispose'])('retains child and parent references after %s despite late callbacks', async operation => {
    const { source, agent, completion } = begin();
    source.emit('REASONING_MESSAGE_START');
    source.reason('CONTENT', { delta: 'child' });
    const child = agent.subagents().get('child');
    expect(child?.messages()).toMatchObject([{ reasoning: 'child' }]);
    if (operation === 'settled') source.emit('RUN_FINISHED');
    else if (operation === 'stop') await agent.stop();
    else agent.dispose();
    const parent = agent.messages();
    const children = agent.subagents();
    const childMessages = child!.messages();
    for (const type of ['START', 'CONTENT', 'CHUNK', 'END']) {
      source.reason(type, { delta: 'late' });
      source.reason(type, { subagentRunId: 'unseen', delta: 'late' });
    }
    expect(agent.messages()).toBe(parent);
    expect(agent.subagents()).toBe(children);
    expect(child!.messages()).toBe(childMessages);
    expect(agent.subagents().has('unseen')).toBe(false);
    source.release();
    await completion;
  });

  it.each(['START', 'CONTENT', 'CHUNK', 'END'])('rejects a foreign child %s body with a current callback envelope', async type => {
    const { source, agent, completion } = begin();
    source.emit('REASONING_MESSAGE_START');
    source.reason('CONTENT', { delta: 'child' });
    const parent = agent.messages();
    const children = agent.subagents();
    const child = children.get('child');
    expect(child?.messages()).toMatchObject([{ reasoning: 'child' }]);
    const messages = child!.messages();
    now = 200;
    source.reason(type, { runId: 'foreign', delta: 'foreign' });
    source.reason(type, { runId: 'foreign', subagentRunId: 'unseen', delta: 'foreign' });
    expect(agent.messages()).toBe(parent);
    expect(agent.subagents()).toBe(children);
    expect(child!.messages()).toBe(messages);
    now = 400;
    source.emit('REASONING_MESSAGE_END');
    expect(agent.messages()[0].reasoningDurationMs).toBe(300);
    source.emit('RUN_FINISHED');
    source.release();
    await completion;
  });
});
