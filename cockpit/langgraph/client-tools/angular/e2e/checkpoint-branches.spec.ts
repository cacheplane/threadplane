import { test, expect } from '@playwright/test';
import {
  calls, client, input, modelJournal, modelRequests, position, run,
} from './checkpoint-protocol.helpers';

const secondPrompt = 'Checkpoint branch original second turn';
const competitorPrompt = 'Checkpoint branch competing later turn';
const forkPrompt = 'Checkpoint branch fork from first turn';

test('checkpoint branches: a fork uses the selected completed turn despite a newer competing tip', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const pending = await run(api, threadId, undefined, input);
    expect(calls(pending)).toHaveLength(1);
    const first = await run(api, threadId, pending.checkpoint, {
      messages: [{ id: 'first-result', type: 'tool', tool_call_id: calls(pending)[0].id, content: '68°F' }],
    });
    expect(first.values.messages.at(-1)).toMatchObject({ type: 'ai', content: 'Protocol weather complete: Paris is 68°F.' });
    const selected = position(first.checkpoint);
    const second = await run(api, threadId, first.checkpoint, {
      messages: [{ id: 'second-question', type: 'human', content: secondPrompt }],
    });
    expect(second.values.messages.at(-1)?.content).toBe('Original second answer.');
    const competitor = await run(api, threadId, second.checkpoint, {
      messages: [{ id: 'competitor-question', type: 'human', content: competitorPrompt }],
    });
    expect(competitor.values.messages.at(-1)?.content).toBe('Competing later answer.');
    // This latest read establishes the adversarial setup only. It is never
    // used as the authority for the following fork or its saved-state read.
    expect((await api.threads.getState(threadId)).checkpoint.checkpoint_id).toBe(competitor.checkpoint.checkpoint_id);

    const before = await modelRequests(forkPrompt);
    const fork = await run(api, threadId, selected, {
      messages: [{ id: 'fork-question', type: 'human', content: forkPrompt }],
    });
    expect(fork.checkpoint.checkpoint_id).not.toBe(selected.checkpoint_id);
    expect(fork.values.messages).toEqual([
      ...first.values.messages,
      expect.objectContaining({ id: 'fork-question', type: 'human', content: forkPrompt }),
      expect.objectContaining({ type: 'ai', content: 'Fork answer from first turn.' }),
    ]);
    const requests = (await modelJournal(forkPrompt)).slice(before);
    expect(requests).toHaveLength(1);
    // Inspect actual model input as well as saved output: a permissive fixture
    // response alone would conceal accidentally including the other branch.
    // The OpenAI adapter encodes an empty tool-call assistant's content as null.
    expect(requests[0].body?.messages?.filter((message) => message.role !== 'system').map((message) => message.content ?? ''))
      .toEqual([...first.values.messages.map((message) => message.content), forkPrompt]);
    expect((await api.threads.getState(threadId, selected)).values).toEqual(first.values);
    expect((await api.threads.getState(threadId, competitor.checkpoint)).values).toEqual(competitor.values);
  } finally {
    await api.threads.delete(threadId);
  }
});

test('checkpoint branches: state writes chain through returned positions instead of creating siblings', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const parent = await run(api, threadId, undefined, input);
    const firstMessage = { id: 'branch-first', type: 'ai', content: 'First owned branch marker.' };
    const siblingMessage = { id: 'branch-sibling', type: 'ai', content: 'Competing sibling marker.' };
    const nextMessage = { id: 'branch-next', type: 'ai', content: 'Next owned branch marker.' };
    const first = position((await api.threads.updateState(threadId, {
      checkpoint: parent.checkpoint, values: { messages: [firstMessage] }, asNode: 'agent', signal: AbortSignal.timeout(10_000),
    })).configurable);
    // Both writes explicitly name the same parent. The second is deliberately
    // later so it also becomes the global tip before the chained write.
    const sibling = position((await api.threads.updateState(threadId, {
      checkpoint: parent.checkpoint, values: { messages: [siblingMessage] }, asNode: 'agent', signal: AbortSignal.timeout(10_000),
    })).configurable);
    expect(first.thread_id).toBe(threadId);
    expect(sibling.thread_id).toBe(threadId);
    expect(new Set([parent.checkpoint.checkpoint_id, first.checkpoint_id, sibling.checkpoint_id]).size).toBe(3);
    const firstState = await api.threads.getState(threadId, first);
    const siblingState = await api.threads.getState(threadId, sibling);
    expect(firstState.parent_checkpoint?.checkpoint_id).toBe(parent.checkpoint.checkpoint_id);
    expect(siblingState.parent_checkpoint?.checkpoint_id).toBe(parent.checkpoint.checkpoint_id);
    expect(firstState.values.messages).toEqual([...parent.values.messages, expect.objectContaining(firstMessage)]);
    expect(siblingState.values.messages).toEqual([...parent.values.messages, expect.objectContaining(siblingMessage)]);
    expect((await api.threads.getState(threadId)).checkpoint.checkpoint_id).toBe(sibling.checkpoint_id);

    const next = position((await api.threads.updateState(threadId, {
      checkpoint: first, values: { messages: [nextMessage] }, asNode: 'agent', signal: AbortSignal.timeout(10_000),
    })).configurable);
    expect(next.thread_id).toBe(threadId);
    expect([parent.checkpoint.checkpoint_id, first.checkpoint_id, sibling.checkpoint_id]).not.toContain(next.checkpoint_id);
    const chained = await api.threads.getState(threadId, next);
    expect(chained.parent_checkpoint?.checkpoint_id).toBe(first.checkpoint_id);
    expect(chained.values.messages).toEqual([...firstState.values.messages, expect.objectContaining(nextMessage)]);
    expect(chained.next).toEqual([]);
    const count = await modelRequests();
    const replay = await run(api, threadId, next);
    expect(replay.values).toEqual(chained.values);
    expect(await modelRequests()).toBe(count);
    expect((await api.threads.getState(threadId, sibling)).values).toEqual(siblingState.values);
  } finally {
    await api.threads.delete(threadId);
  }
});
