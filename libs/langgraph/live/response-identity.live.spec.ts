import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  liveSession,
  recordSnapshots,
  startLiveBackend,
  type LiveBackend,
} from './backend';

/**
 * One model response as one message, against the chat graph. Its model
 * answers through the OpenAI Responses API, so each response opens with a
 * chunk under the provider's response id and continues under the placeholder
 * id of the model run. The saved thread holds one message for it.
 */
let backend: LiveBackend;
const sessions: { dispose(): Promise<void> }[] = [];

beforeAll(async () => {
  backend = await startLiveBackend({
    python: 'examples/chat/python',
    graph: 'chat',
    fixtures: ['examples/chat/angular/e2e/fixtures/streaming.json'],
  });
});
afterAll(async () => {
  await Promise.allSettled(sessions.map((session) => session.dispose()));
  await backend?.stop();
});

const PROMPT = 'stream a long deterministic answer';
const savedAssistants = (values: unknown) =>
  (
    (values as { messages?: { type: string; id: string; content: unknown }[] })
      .messages ?? []
  ).filter((message) => message.type === 'ai');

describe('a response streamed under two wire ids', () => {
  it('reaches the client under a response id and then a run placeholder id', async () => {
    // The premise of the next test, read from the wire with a plain client.
    const threadId = await backend.thread();
    const chunkIds = new Set<string>();
    for await (const event of backend.client.runs.stream(
      threadId,
      backend.graph,
      {
        input: { messages: [{ type: 'human', content: PROMPT }] },
        streamMode: ['messages-tuple', 'values'],
      }
    )) {
      if (event.event !== 'messages') continue;
      const [message] = event.data as unknown as [
        { type?: string; id?: string }
      ];
      if (message?.type === 'AIMessageChunk' && message.id)
        chunkIds.add(message.id);
    }
    const saved = savedAssistants((await backend.saved(threadId)).values);
    expect(saved).toHaveLength(1);
    expect([...chunkIds]).toContain(saved[0].id);
    expect(
      [...chunkIds].filter((id) => id.startsWith('lc_run-'))
    ).toHaveLength(1);
    expect(chunkIds.size).toBe(2);
  });

  it('is one assistant message, under the saved id, in every snapshot', async () => {
    const session = liveSession(backend, { transcriptNodeNames: ['generate'] });
    sessions.push(session);
    const recorded = recordSnapshots(session);
    expect(await session.submit(PROMPT)).toBe('success');
    recorded.release();
    const saved = savedAssistants(
      (await backend.saved(session.threadId as string)).values
    );
    expect(saved).toHaveLength(1);
    const assistants = recorded.snapshots.map((snapshot) =>
      snapshot.messages.filter((message) => message.role === 'assistant')
    );
    // The reply streamed: it was published many times before it was final.
    expect(
      new Set(assistants.map((messages) => messages[0]?.content)).size
    ).toBeGreaterThan(3);
    for (const messages of assistants)
      expect(messages.map((message) => message.id)).toEqual(
        messages.length ? [saved[0].id] : []
      );
    const final = session.getSnapshot();
    expect(
      final.messages.map((message) => [message.role, message.id])
    ).toEqual([
      ['user', final.messages[0].id],
      ['assistant', saved[0].id],
    ]);
    expect(final.messages[1].content.length).toBeGreaterThan(512);
  });
});
