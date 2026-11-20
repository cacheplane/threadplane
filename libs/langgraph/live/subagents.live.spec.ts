import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  liveSession,
  recordSnapshots,
  settled,
  startLiveBackend,
  type LiveBackend,
} from './backend';

/**
 * Child agents against two graphs that delegate through a `task` tool: a deep
 * agent, whose children are real agents with their own tools and whose
 * namespaces the session must relate by inference, and a hand-built
 * orchestrator that states the relation with the middleware's binding event.
 */
const sessions: { dispose(): Promise<void> }[] = [];
const track = <S extends { dispose(): Promise<void> }>(session: S): S => {
  sessions.push(session);
  return session;
};
afterAll(async () => {
  await Promise.allSettled(sessions.map((session) => session.dispose()));
});

describe('a deep agent that delegates to one child', () => {
  let backend: LiveBackend;
  beforeAll(async () => {
    backend = await startLiveBackend({
      python: 'cockpit/deep-agents/subagents/python',
      graph: 'subagents',
      fixtures: [
        'cockpit/deep-agents/subagents/angular/e2e/fixtures/da-subagents-single.json',
      ],
    });
  });
  afterAll(async () => {
    await backend?.stop();
  });

  const PROMPT = 'What is the field data for KSFO?';
  const TASK =
    'Gather the field elevation and runway length for San Francisco International Airport (KSFO). Return both values clearly labeled.';

  it('relates the child to the tool call that started it and keeps its transcript apart', async () => {
    const session = track(liveSession(backend));
    const recorded = recordSnapshots(session);
    expect(await session.submit(PROMPT)).toBe('success');
    recorded.release();
    const snapshot = session.getSnapshot();

    // The root transcript: the delegation call, its result, the answer.
    expect(snapshot.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(snapshot.toolCalls).toHaveLength(1);
    const [call] = snapshot.toolCalls;
    expect(call).toMatchObject({
      name: 'task',
      status: 'complete',
      args: { subagent_type: 'field-researcher', description: TASK },
    });

    expect(snapshot.subagents).toHaveLength(1);
    const [child] = snapshot.subagents;
    // The graph states no relation: the session inferred it from the task text.
    expect(child.toolCallId).toBe(call.id);
    expect(child.name).toBe('field-researcher');
    expect(child.description).toBe(TASK);
    expect(child.parentId).toBeUndefined();
    expect(child.status).toBe('complete');
    expect(child.namespace).toHaveLength(1);
    expect(child.namespace[0]).toMatch(/^tools:/);
    expect(child.id).toBe(JSON.stringify(child.namespace));

    // The child's own work is its own: prompt, tool calls, results, answer.
    expect(child.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(child.messages[0].content).toBe(TASK);
    expect(
      child.toolCalls.map((entry) => [entry.name, entry.status, entry.args])
    ).toEqual([
      ['lookup_field_elevation', 'complete', { airport: 'KSFO' }],
      ['lookup_runway_length', 'complete', { airport: 'KSFO' }],
    ]);
    expect(
      child.toolCalls.map(
        (entry) => entry.status === 'complete' && entry.result
      )
    ).toEqual([
      'KSFO field elevation is 13 ft.',
      'KSFO longest runway is 11870 ft.',
    ]);
    // None of it is repeated in the root transcript or the root tool calls.
    const rootIds = new Set(snapshot.messages.map((message) => message.id));
    expect(child.messages.some((message) => rootIds.has(message.id))).toBe(
      false
    );
    expect(
      snapshot.toolCalls.some((entry) => entry.name.startsWith('lookup_'))
    ).toBe(false);
    // The child's result is what the root call returned.
    expect(call.status === 'complete' && call.result).toBe(
      child.messages.at(-1)?.content
    );

    // The child's own state is published as plain data.
    expect(child.state).toBeDefined();
    expect(Object.isFrozen(child.state)).toBe(true);
    expect(child.state).not.toHaveProperty('messages');

    // While it worked, the child was running and already related.
    const statuses = recorded.snapshots.flatMap((entry) =>
      entry.subagents.map((agent) => `${agent.status}:${agent.toolCallId}`)
    );
    expect(statuses).toContain(`running:${call.id}`);
    expect(new Set(statuses)).toEqual(
      new Set([`running:${call.id}`, `complete:${call.id}`])
    );
    // One child for the life of the session, under one id.
    expect(
      new Set(
        recorded.snapshots.flatMap((entry) =>
          entry.subagents.map((agent) => agent.id)
        )
      )
    ).toEqual(new Set([child.id]));
  });

  it('lists the calls a model is still writing, for the root and for the child', async () => {
    const session = track(liveSession(backend));
    const recorded = recordSnapshots(session);
    expect(await session.submit(PROMPT)).toBe('success');
    recorded.release();
    const snapshot = session.getSnapshot();
    const [call] = snapshot.toolCalls;

    // The root's delegation call streamed its arguments before it was final.
    const root = recorded.snapshots.flatMap(
      (entry) => entry.streamingToolCalls ?? []
    );
    expect(root.length).toBeGreaterThan(0);
    expect(new Set(root.map((entry) => `${entry.name}:${entry.id}`))).toEqual(
      new Set([`task:${call.id}`])
    );
    expect(root.at(-1)?.args).toEqual(call.args);
    // The child's lookups streamed under the child, never under the root.
    const child = recorded.snapshots.flatMap((entry) =>
      entry.subagents.flatMap((agent) => agent.streamingToolCalls ?? [])
    );
    expect(new Set(child.map((entry) => entry.name))).toEqual(
      new Set(['lookup_field_elevation', 'lookup_runway_length'])
    );
    expect(new Set(child.map((entry) => entry.id))).toEqual(
      new Set(snapshot.subagents[0].toolCalls.map((entry) => entry.id))
    );
    // Nothing is left streaming once the run has settled.
    expect('streamingToolCalls' in snapshot).toBe(false);
    expect('streamingToolCalls' in snapshot.subagents[0]).toBe(false);
  });

  it('relates nothing when no tool name starts a child', async () => {
    const session = track(liveSession(backend, { subagentToolNames: [] }));
    expect(await session.submit(PROMPT)).toBe('success');
    const [child] = session.getSnapshot().subagents;
    expect(child.toolCallId).toBeUndefined();
    expect(child.description).toBeUndefined();
    // Named after the node that started it, as any child graph is.
    expect(child.name).toBe('tools');
    expect(child.messages.length).toBeGreaterThan(0);
    // A tool that is not listed relates nothing either.
    const other = track(
      liveSession(backend, { subagentToolNames: ['delegate'] })
    );
    expect(await other.submit(PROMPT)).toBe('success');
    expect(other.getSnapshot().subagents[0].toolCallId).toBeUndefined();
  });

  it('restores the child from the saved thread under the namespace it ran in', async () => {
    const author = track(liveSession(backend));
    expect(await author.submit(PROMPT)).toBe('success');
    const [live] = author.getSnapshot().subagents;

    // By default a history load publishes no child: no child event replays.
    const plain = track(liveSession(backend, { threadId: author.threadId }));
    await plain.load?.();
    expect(plain.getSnapshot().subagents).toEqual([]);
    expect(plain.getSnapshot().toolCalls).toHaveLength(1);

    const session = track(
      liveSession(backend, {
        threadId: author.threadId,
        restoreSubagents: true,
      })
    );
    await session.load?.();
    const [restored] = session.getSnapshot().subagents;
    // History links the call to the task that ran it, so the restored child
    // has the id the live child had: a continued run would update the same one.
    expect(restored.id).toBe(live.id);
    expect(restored).toMatchObject({
      toolCallId: live.toolCallId,
      name: 'field-researcher',
      description: TASK,
      status: 'complete',
    });
    expect(session.getSnapshot().messages.map((m) => m.content)).toEqual(
      author.getSnapshot().messages.map((m) => m.content)
    );
  });

  it('cannot read the child transcript back: this backend serves no checkpoint for a tool-started child', async () => {
    // What the session asks for when it restores a child's transcript. The
    // server answers 400 for a child agent started inside a tool, so a
    // restored child keeps its relation and status and has no messages.
    const author = track(liveSession(backend));
    expect(await author.submit(PROMPT)).toBe('success');
    const [live] = author.getSnapshot().subagents;
    await expect(
      backend.client.threads.getHistory(author.threadId as string, {
        checkpoint: { checkpoint_ns: live.namespace[0] },
        limit: 1,
      })
    ).rejects.toThrow(/400/);

    const session = track(
      liveSession(backend, {
        threadId: author.threadId,
        restoreSubagents: true,
      })
    );
    await session.load?.();
    await new Promise((done) => setTimeout(done, 1000));
    const [restored] = session.getSnapshot().subagents;
    // The failed read is contained: the thread loaded and the child is listed.
    expect(session.getSnapshot().status).toBe('idle');
    expect(session.getSnapshot().error).toBeUndefined();
    expect(restored.status).toBe('complete');
    expect(restored.messages).toEqual([]);
  });
});

describe('an orchestrator that announces its children', () => {
  let backend: LiveBackend;
  beforeAll(async () => {
    backend = await startLiveBackend({
      python: 'cockpit/chat/subagents/python',
      graph: 'c-subagents',
      fixtures: [
        'libs/langgraph/live/fixtures/c-subagents-live.json',
        'cockpit/chat/subagents/angular/e2e/fixtures/c-subagents.json',
      ],
    });
  });
  afterAll(async () => {
    await backend?.stop();
  });

  const PROMPT = 'Plan a trip from LAX to JFK';
  const types = ['research', 'booking', 'itinerary'];

  it('relates each child to its own call, one after another, and completes each as its call returns', async () => {
    const session = track(liveSession(backend));
    const recorded = recordSnapshots(session);
    expect(await session.submit(PROMPT)).toBe('success');
    recorded.release();
    const snapshot = session.getSnapshot();

    expect(snapshot.toolCalls.map((call) => [call.name, call.status])).toEqual(
      types.map(() => ['task', 'complete'])
    );
    expect(
      snapshot.toolCalls.map(
        (call) => (call.args as { subagent_type: string }).subagent_type
      )
    ).toEqual(types);

    // One child for each call, in start order, each related to its own call.
    expect(snapshot.subagents.map((child) => child.name)).toEqual(types);
    expect(snapshot.subagents.map((child) => child.toolCallId)).toEqual(
      snapshot.toolCalls.map((call) => call.id)
    );
    expect(new Set(snapshot.subagents.map((child) => child.id)).size).toBe(3);
    expect(
      snapshot.subagents.every((child) => child.status === 'complete')
    ).toBe(true);

    for (const [index, child] of snapshot.subagents.entries()) {
      const call = snapshot.toolCalls[index];
      // The child's answer is what its call returned to the orchestrator.
      expect(child.messages.map((message) => message.role)).toEqual([
        'assistant',
      ]);
      expect(call.status === 'complete' && call.result).toBe(
        child.messages[0].content
      );
      // Its own state, as the child graph declared it.
      expect(child.state).toEqual({
        subagent_type: types[index],
        task_description: (call.args as { task_description: string })
          .task_description,
      });
    }
    // The children's answers are not root messages.
    const rootIds = new Set(snapshot.messages.map((message) => message.id));
    expect(
      snapshot.subagents.some((child) =>
        child.messages.some((message) => rootIds.has(message.id))
      )
    ).toBe(false);

    // A child was complete as soon as its call had a result, while the root
    // run went on to start the next one.
    const during = recorded.snapshots.filter(
      (entry) => entry.status === 'running'
    );
    expect(
      during.some(
        (entry) =>
          entry.subagents.length === 2 &&
          entry.subagents[0].status === 'complete' &&
          entry.subagents[1].status === 'running'
      )
    ).toBe(true);
    // A child never appeared related to a call other than its own.
    for (const entry of recorded.snapshots)
      for (const [index, child] of entry.subagents.entries())
        expect([undefined, snapshot.toolCalls[index].id]).toContain(
          child.toolCallId
        );
  });

  it('leaves the children unrelated when no tool name is given', async () => {
    const session = track(liveSession(backend, { subagentToolNames: [] }));
    expect(await session.submit(PROMPT)).toBe('success');
    const { subagents } = session.getSnapshot();
    expect(subagents).toHaveLength(3);
    expect(subagents.every((child) => child.toolCallId === undefined)).toBe(
      true
    );
    expect(subagents.map((child) => child.name)).toEqual([
      'tools',
      'tools',
      'tools',
    ]);
  });

  it('restores the children a saved thread records, by the calls that started them', async () => {
    const author = track(liveSession(backend));
    expect(await author.submit(PROMPT)).toBe('success');
    const session = track(
      liveSession(backend, {
        threadId: author.threadId,
        restoreSubagents: true,
      })
    );
    await session.load?.();
    const restored = await settled(
      session,
      (snapshot) => snapshot.subagents.length === 3
    );
    expect(restored.subagents.map((child) => child.name)).toEqual(types);
    expect(restored.subagents.map((child) => child.toolCallId)).toEqual(
      restored.toolCalls.map((call) => call.id)
    );
    expect(
      restored.subagents.every((child) => child.status === 'complete')
    ).toBe(true);
    expect(restored.subagents.map((child) => child.toolCallId)).toEqual(
      author.getSnapshot().subagents.map((child) => child.toolCallId)
    );
  });

  it('shows a delegation whose tool failed as an error, not as complete', async () => {
    const session = track(liveSession(backend));
    expect(
      await session.submit(
        'Ask the cabin crew specialist to brief the passengers.'
      )
    ).toBe('success');
    const snapshot = session.getSnapshot();
    expect(snapshot.toolCalls).toHaveLength(1);
    const [call] = snapshot.toolCalls;
    // The tool rejected the specialist it was asked for; its tool message
    // says so with an error status, and the call carries that.
    expect(call).toMatchObject({
      name: 'task',
      status: 'error',
      args: { subagent_type: 'cabin-crew' },
    });
    expect(call.status === 'error' && call.error).toMatch(/cabin-crew|Error/);
    const saved = await backend.saved(session.threadId as string);
    const tool = (
      saved.values as {
        messages: { type: string; status?: string; content: string }[];
      }
    ).messages.find((message) => message.type === 'tool');
    expect(tool?.status).toBe('error');
    expect(call.status === 'error' && call.error).toBe(tool?.content);
    // The orchestrator still answered.
    expect(snapshot.messages.at(-1)?.content).toBe(
      'There is no cabin crew specialist, so nobody was briefed.'
    );
    // A reload shows the same failure.
    const reloaded = track(
      liveSession(backend, { threadId: session.threadId })
    );
    await reloaded.load?.();
    expect(reloaded.getSnapshot().toolCalls[0]).toMatchObject({
      status: 'error',
      error: tool?.content,
    });
  });
});
