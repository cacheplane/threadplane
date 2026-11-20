import {
  AbstractAgent,
  HttpAgent,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { Observable, type Subscriber } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { memoryStore } from './testing/memory-store';

/** An agent that is not HTTP: each run is a stream the test writes to. */
class ScriptedAgent extends AbstractAgent {
  readonly runs: {
    input: RunAgentInput;
    subscriber: Subscriber<BaseEvent>;
    unsubscribed: boolean;
  }[] = [];
  readonly aborts = vi.fn();
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const run = { input, subscriber, unsubscribed: false };
      this.runs.push(run);
      return () => {
        run.unsubscribed = true;
      };
    });
  }
  override abortRun(): void {
    this.aborts();
  }
  emit(index: number, ...events: object[]) {
    for (const event of events) this.runs[index].subscriber.next(event as BaseEvent);
  }
  lifecycle(index: number, type: 'RUN_STARTED' | 'RUN_FINISHED') {
    const { threadId, runId } = this.runs[index].input;
    this.emit(index, { type, threadId, runId });
  }
  async started(index: number) {
    await vi.waitFor(() => expect(this.runs.length).toBeGreaterThan(index));
    return this.runs[index];
  }
}

describe('a session over a client agent', () => {
  it('sends each request through the agent with the full input, and reads its events', async () => {
    const agent = new ScriptedAgent({ threadId: 'agent-thread', agentId: 'planner' });
    const session = createSession({ agent, state: { city: 'Rome' } });
    expect(session.threadId).toBe('agent-thread');
    expect(session.agentId).toBe('planner');
    await expect(session.ready).resolves.toBeUndefined();

    const done = session.submit('Plan a visit');
    const run = await agent.started(0);
    expect(run.input).toMatchObject({
      threadId: 'agent-thread',
      state: { city: 'Rome' },
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(run.input.messages).toMatchObject([{ role: 'user', content: 'Plan a visit' }]);
    agent.lifecycle(0, 'RUN_STARTED');
    // Chunk events are expanded as for an HTTP response.
    agent.emit(
      0,
      { type: 'TEXT_MESSAGE_CHUNK', messageId: 'a1', role: 'assistant', delta: 'Day ' },
      { type: 'TEXT_MESSAGE_CHUNK', messageId: 'a1', delta: 'one' }
    );
    agent.lifecycle(0, 'RUN_FINISHED');
    expect(await done).toBe('success');
    expect(session.getSnapshot().messages.map((message) => message.content)).toEqual([
      'Plan a visit',
      'Day one',
    ]);
    // The session is its own authority: the agent's history is not touched.
    expect(agent.messages).toEqual([]);
    expect(agent.aborts).not.toHaveBeenCalled();

    const again = session.submit('And day two?');
    const second = await agent.started(1);
    expect(second.input.messages).toHaveLength(3);
    agent.lifecycle(1, 'RUN_STARTED');
    agent.lifecycle(1, 'RUN_FINISHED');
    expect(await again).toBe('success');
    await session.dispose();
  });

  it('prefers the options over what the agent names', () => {
    const agent = new ScriptedAgent({ threadId: 'agent-thread', agentId: 'planner' });
    const session = createSession({ agent, threadId: 'mine', agentId: 'other' });
    expect(session.threadId).toBe('mine');
    expect(session.agentId).toBe('other');
  });

  it('stops a run by leaving its stream and telling the agent', async () => {
    const agent = new ScriptedAgent();
    const session = createSession({ agent });
    const done = session.submit('Go');
    const run = await agent.started(0);
    agent.lifecycle(0, 'RUN_STARTED');
    await session.stop();
    expect(await done).toBe('aborted');
    expect(run.unsubscribed).toBe(true);
    expect(agent.aborts).toHaveBeenCalledOnce();
    expect(session.getSnapshot().status).toBe('idle');
    await session.dispose();
  });

  it('reports a stream that completes without a terminal, and one that errors', async () => {
    const agent = new ScriptedAgent();
    const session = createSession({ agent });
    const cut = session.submit('Go');
    const first = await agent.started(0);
    agent.lifecycle(0, 'RUN_STARTED');
    first.subscriber.complete();
    expect(await cut).toBe('interrupted');
    const failed = session.submit('Again');
    const second = await agent.started(1);
    second.subscriber.error(new Error('socket closed'));
    expect(await failed).toBe('error');
    expect(session.getSnapshot().error).toMatchObject({ kind: 'server', retryable: false });
    await session.dispose();
  });

  it('answers a pause through the agent, and sends nothing for an answer cancelled before run', async () => {
    const agent = new ScriptedAgent();
    const session = createSession({ agent });
    const paused = session.submit('Book it');
    await agent.started(0);
    agent.lifecycle(0, 'RUN_STARTED');
    const { threadId, runId } = agent.runs[0].input;
    agent.emit(0, {
      type: 'RUN_FINISHED',
      threadId,
      runId,
      outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] },
    });
    expect(await paused).toBe('paused');
    const yes = [{ interruptId: 'i1', status: 'resolved' as const, value: true }];
    const controller = new AbortController();
    const cancelled = session.resume(yes, { signal: controller.signal });
    controller.abort();
    expect(await cancelled).toBe('aborted');
    // The agent's run was never called, so the claim is released.
    expect(agent.runs).toHaveLength(1);
    expect(session.getSnapshot().interrupts).toHaveLength(1);

    const answered = session.resume(yes);
    const second = await agent.started(1);
    expect(second.input.resume).toEqual([
      { interruptId: 'i1', status: 'resolved', payload: true },
    ]);
    agent.lifecycle(1, 'RUN_STARTED');
    agent.lifecycle(1, 'RUN_FINISHED');
    expect(await answered).toBe('success');
    await session.dispose();
  });

  it('runs client tools over the agent', async () => {
    const agent = new ScriptedAgent();
    const handler = vi.fn((args: { value: number }) => args.value + 1);
    const session = createSession(
      { agent },
      { add: { description: 'add', parameters: {}, handler } }
    );
    const done = session.submit('Add');
    const first = await agent.started(0);
    expect(first.input.tools).toMatchObject([{ name: 'add' }]);
    agent.lifecycle(0, 'RUN_STARTED');
    agent.emit(
      0,
      { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'add', parentMessageId: 'a1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"value":1}' },
      { type: 'TOOL_CALL_END', toolCallId: 'c1' }
    );
    agent.lifecycle(0, 'RUN_FINISHED');
    const second = await agent.started(1);
    expect(second.input.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: '2',
    });
    agent.lifecycle(1, 'RUN_STARTED');
    agent.lifecycle(1, 'RUN_FINISHED');
    expect(await done).toBe('success');
    expect(handler).toHaveBeenCalledOnce();
    await session.dispose();
  });

  it('runs an HTTP agent the caller built, again after a stop', async () => {
    const bodies: RunAgentInput[] = [];
    const agent = new HttpAgent({
      url: 'https://agent.invalid/run',
      threadId: 'http-thread',
      headers: { authorization: 'Bearer x' },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as RunAgentInput;
        bodies.push(body);
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer x');
        if (bodies.length === 1)
          // Held open until the test stops the run.
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'content-type': 'text/event-stream' },
          });
        const events = [
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
        ];
        return new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      },
    });
    const session = createSession({ agent });
    const first = session.submit('One');
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    await session.stop();
    expect(await first).toBe('aborted');
    // A stopped HTTP agent keeps an aborted controller; the next run gets a new one.
    expect(await session.submit('Two')).toBe('success');
    expect(bodies[1].threadId).toBe('http-thread');
    expect(bodies[1].messages).toHaveLength(2);
    await session.dispose();
  });
});

describe('thread and agent identity', () => {
  const url = 'https://agent.invalid/run';
  const quiet = async () =>
    new Response('', { headers: { 'content-type': 'text/event-stream' } });

  it('generates a thread when none is given and sends it with each request', async () => {
    const seen: string[] = [];
    const session = createSession({
      url,
      fetch: async (_url, init) => {
        seen.push(JSON.parse(String(init?.body)).threadId);
        return quiet();
      },
    });
    expect(session.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.agentId).toBeUndefined();
    expect(createSession({ url }).threadId).not.toBe(session.threadId);
    await session.submit('Go');
    expect(seen).toEqual([session.threadId]);
    await session.dispose();
  });

  it('publishes the agentId it was given, with and without client tools', () => {
    expect(createSession({ url, threadId: 't', agentId: 'planner' }).agentId).toBe('planner');
    const tools = createSession(
      { url, threadId: 't', agentId: 'planner' },
      { f: { description: 'f', handler: () => 1 } }
    );
    expect(tools.agentId).toBe('planner');
    expect(tools.threadId).toBe('t');
  });

  it('rejects an empty thread, a url with an agent, and persistence without a chosen thread', () => {
    expect(() => createSession({ url, threadId: '' })).toThrow('A nonempty threadId is required');
    expect(() =>
      createSession({ url, agent: new ScriptedAgent() } as never)
    ).toThrow('a url or an agent, not both');
    const persistence = { namespace: 'app', store: memoryStore().store };
    expect(() => createSession({ url, persistence })).toThrow(
      'Persistence requires a stable threadId'
    );
    // An agent's own thread is one the application chose.
    expect(
      createSession({ agent: new ScriptedAgent({ threadId: 'kept' }), persistence }).threadId
    ).toBe('kept');
  });

  it('skips replay for a conversation that has no thread yet', async () => {
    const replay = vi.fn(async () => []);
    const session = createSession({ url, replay });
    await session.ready;
    expect(replay).not.toHaveBeenCalled();
    expect(session.getSnapshot().inputBlocked).toBeUndefined();
    const given = createSession({ url, threadId: 't', replay });
    await given.ready;
    expect(replay).toHaveBeenCalledOnce();
  });
});
