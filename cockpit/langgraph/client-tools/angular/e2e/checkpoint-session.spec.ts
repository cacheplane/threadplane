import { expect, test } from '@playwright/test';
import { createSession } from '../../../../../libs/langgraph/src/runtime/create-session';
import { FetchStreamTransport } from '../../../../../libs/langgraph/src/lib/transport/fetch-stream.transport';
import {
  backendUrl, client, modelJournal, position as wirePosition, prompt, run,
} from './checkpoint-protocol.helpers';

const sourcePrompt = 'Checkpoint branch original second turn';
const competitorPrompt = 'Checkpoint branch competing later turn';
const forkPrompt = 'Checkpoint branch fork from first turn';
const advancePrompt = 'Checkpoint continuity advance the competing branch';
const followUpPrompt = 'Checkpoint continuity continue the completed fork';

function position(config: Parameters<typeof wirePosition>[0]) {
  const owned = wirePosition(config);
  // The server omits an empty map on saved states but can echo {} in frames
  // when the request supplied it. Both represent the same root routing.
  return { ...owned, checkpoint_map: owned.checkpoint_map ?? {} };
}

// Observe the real adapter without supplying synthetic events, state or receipts.
class ObservedTransport extends FetchStreamTransport {
  readonly creations: Parameters<FetchStreamTransport['stream']>[] = [];
  readonly checkpoints: ReturnType<typeof position>[] = [];
  readonly writes: { args: Parameters<FetchStreamTransport['updateState']>; result: unknown }[] = [];

  override async *stream(...args: Parameters<FetchStreamTransport['stream']>) {
    this.creations.push(args);
    for await (const event of super.stream(...args)) {
      if (event.type === 'checkpoints') {
        const data = event.data as { config: { configurable?: Record<string, unknown> } };
        this.checkpoints.push(position(data.config.configurable));
      }
      yield event;
    }
  }

  override async updateState(...args: Parameters<FetchStreamTransport['updateState']>) {
    const result = await super.updateState(...args);
    this.writes.push({ args, result });
    return result;
  }

  finalPosition() {
    const checkpoint = this.checkpoints.at(-1);
    if (!checkpoint) throw new Error('Session must obtain a real root checkpoint');
    return checkpoint;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function descendsFrom(
  api: ReturnType<typeof client>, threadId: string,
  child: Awaited<ReturnType<typeof run>>, parent: ReturnType<typeof position>,
  excluded: readonly string[],
) {
  let ancestor = child;
  const visited = new Set<string>();
  for (let depth = 0; depth < 8; depth++) {
    const current = position(ancestor.checkpoint);
    expect(current.thread_id).toBe(threadId);
    expect(current.checkpoint_ns).toBe('');
    expect(excluded).not.toContain(current.checkpoint_id);
    expect(visited.has(current.checkpoint_id)).toBe(false);
    visited.add(current.checkpoint_id);
    if (current.checkpoint_id === parent.checkpoint_id) break;
    ancestor = await api.threads.getState(threadId, position(ancestor.parent_checkpoint ?? undefined));
  }
  expect(position(ancestor.checkpoint)).toEqual(parent);
}

for (const followUp of [true, false]) {
  test(`checkpoint session: retains its fork through reads, submissions and ${followUp ? 'tool continuation' : 'terminal tool persistence'}`, async () => {
    const api = client();
    const { thread_id: threadId } = await api.threads.create();
    const started = deferred();
    const release = deferred();
    let handlers = 0;
    const transport = new ObservedTransport(backendUrl(), undefined, { maxRetries: 0 });
    const session = createSession({
      assistantId: 'client-tools', threadId, transport,
      tools: {
        get_weather: {
          description: 'Get weather for a location',
          parameters: { type: 'object', properties: { location: { type: 'string' } } },
          followUp,
          handler: async (args: { location: string }) => {
            handlers++;
            expect(args).toEqual({ location: 'Paris' });
            started.resolve();
            await release.promise;
            return '68°F';
          },
        },
      },
    });
    try {
      const source = await run(api, threadId, undefined, {
        messages: [{ id: 'source-question', type: 'human', content: sourcePrompt }],
      });
      const sourcePosition = position(source.checkpoint);
      const competitor = await run(api, threadId, sourcePosition, {
        messages: [{ id: 'competitor-question', type: 'human', content: competitorPrompt }],
      });
      await session.load?.();
      expect(session.getSnapshot().messages.at(-1)?.content).toBe('Competing later answer.');
      const beforeFork = (await modelJournal(forkPrompt)).length;
      expect(await session.fork(sourcePosition, forkPrompt)).toBe('success');
      expect(session.getSnapshot().messages.map((message) => message.content)).toEqual([
        ...source.values.messages.map((message) => message.content), forkPrompt, 'Fork answer from first turn.',
      ]);
      const fork = transport.finalPosition();
      const savedFork = await api.threads.getState(threadId, fork);
      expect(savedFork.values.messages).toEqual([
        ...source.values.messages,
        expect.objectContaining({ type: 'human', content: forkPrompt }),
        expect.objectContaining({ type: 'ai', content: 'Fork answer from first turn.' }),
      ]);
      await descendsFrom(api, threadId, savedFork, sourcePosition, [position(competitor.checkpoint).checkpoint_id]);
      const forkRequests = (await modelJournal(forkPrompt)).slice(beforeFork);
      expect(forkRequests).toHaveLength(1);
      expect(forkRequests[0].body?.messages?.filter((message) => message.role !== 'system').map((message) => message.content ?? ''))
        .toEqual([...source.values.messages.map((message) => message.content), forkPrompt]);

      const advanced = await run(api, threadId, position(competitor.checkpoint), {
        messages: [{ id: 'advanced-competitor', type: 'human', content: advancePrompt }],
      });
      expect(position((await api.threads.getState(threadId)).checkpoint)).toEqual(position(advanced.checkpoint));
      await session.load?.();
      expect(session.getSnapshot().messages.map((message) => message.content))
        .toEqual(savedFork.values.messages.map((message) => message.content));
      const beforeFollowUp = (await modelJournal(followUpPrompt)).length;
      expect(await session.submit(followUpPrompt)).toBe('success');
      const followed = transport.finalPosition();
      const savedFollowed = await api.threads.getState(threadId, followed);
      expect(savedFollowed.values.messages.map((message) => message.content)).toEqual([
        ...savedFork.values.messages.map((message) => message.content), followUpPrompt, 'Completed fork follow-up answer.',
      ]);
      await descendsFrom(api, threadId, savedFollowed, fork, [competitor, advanced].map((state) => position(state.checkpoint).checkpoint_id));
      const followUpRequests = (await modelJournal(followUpPrompt)).slice(beforeFollowUp);
      expect(followUpRequests).toHaveLength(1);
      expect(followUpRequests[0].body?.messages?.filter((message) => message.role !== 'system').map((message) => message.content ?? ''))
        .toEqual([...savedFork.values.messages.map((message) => message.content), followUpPrompt]);

      const beforeTool = (await modelJournal()).length;
      const beforeCreations = transport.creations.length;
      const outcome = session.submit(prompt);
      // Await actual handler entry, not a timer or an outcome label. Its result
      // is held while another writer moves the global tip.
      await Promise.race([
        started.promise,
        outcome.then((result) => { throw new Error(`Tool never started: ${result}; ${JSON.stringify(session.getSnapshot().error)}`); }),
      ]);
      const pending = transport.finalPosition();
      const pendingState = await api.threads.getState(threadId, pending);
      const call = pendingState.values.messages.flatMap((message) => message.tool_calls ?? []).at(-1);
      expect(call).toMatchObject({ name: 'get_weather', args: { location: 'Paris' } });
      expect(pendingState.values.messages).toEqual([
        ...savedFollowed.values.messages,
        expect.objectContaining({ type: 'human', content: prompt }),
        expect.objectContaining({ type: 'ai', tool_calls: [call] }),
      ]);
      const toolRequests = (await modelJournal()).slice(beforeTool);
      expect(toolRequests).toHaveLength(1);
      expect(toolRequests[0].body?.messages?.filter((message) => message.role !== 'system').map((message) => message.content ?? ''))
        .toEqual([...savedFollowed.values.messages.map((message) => message.content), prompt]);
      await descendsFrom(api, threadId, pendingState, followed, [competitor, advanced].map((state) => position(state.checkpoint).checkpoint_id));
      const other = await run(api, threadId, position(advanced.checkpoint), {
        messages: [{ id: 'during-handler-competitor', type: 'human', content: competitorPrompt }],
      });
      expect(position((await api.threads.getState(threadId)).checkpoint)).toEqual(position(other.checkpoint));
      release.resolve();
      expect(await outcome).toBe('success');
      expect(handlers).toBe(1);
      expect(transport.creations.length - beforeCreations).toBe(followUp ? 2 : 1);
      expect(transport.writes).toHaveLength(followUp ? 0 : 1);
      const exact = followUp ? transport.finalPosition() : position(transport.writes[0].result as Record<string, unknown>);
      const saved = await api.threads.getState(threadId, exact);
      const toolMessage = expect.objectContaining({
        type: 'tool', tool_call_id: call?.id, content: '68°F',
      });
      expect(saved.values.messages).toEqual([
        ...pendingState.values.messages, toolMessage,
        ...(followUp ? [expect.objectContaining({ type: 'ai', content: 'Protocol weather complete: Paris is 68°F.' })] : []),
      ]);
      expect(saved.next).toEqual([]);
      const requests = (await modelJournal()).slice(beforeTool);
      expect(requests).toHaveLength(followUp ? 2 : 1);
      if (followUp) {
        expect(requests[1].body?.messages?.filter((message) => message.role === 'tool'))
          .toEqual([expect.objectContaining({ tool_call_id: call?.id, content: '68°F' })]);
      }

      // Read only exact parents. A fixture's answer alone cannot prove routing.
      await descendsFrom(api, threadId, saved, pending, [competitor, advanced, other].map((state) => position(state.checkpoint).checkpoint_id));
      await session.load?.();
      expect(session.getSnapshot().messages.map((message) => message.content))
        .toEqual(saved.values.messages.map((message) => message.content));
      for (const original of [source, competitor, advanced, other]) {
        expect((await api.threads.getState(threadId, position(original.checkpoint))).values).toEqual(original.values);
      }
    } finally {
      release.resolve();
      session.dispose();
      await api.threads.delete(threadId);
    }
  });
}
