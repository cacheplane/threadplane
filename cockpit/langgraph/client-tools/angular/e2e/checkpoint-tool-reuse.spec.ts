import { test, expect } from '@playwright/test';
import type { PlainValue, ToolCall } from '@threadplane/core';
import type { FunctionToolDefinition, ToolExecutionStore } from '@threadplane/core/tools';
import {
  captureTools, createToolBuffer, executeTool, type ToolExecutionOutcome,
} from '../../../../../libs/langgraph/src/runtime/function-tools';
import { canonicalInvocation } from '../../../../../libs/langgraph/src/runtime/tool-provenance';
import { createInMemoryClientToolExecutionStore } from '../../../../../libs/middleware/src/langgraph/client-tool-execution-store';
import {
  calls, client, input, modelJournal, modelRequests, run,
} from './checkpoint-protocol.helpers';

// Test-only source composition of the private executor, production memory
// provider and real graph protocol. Memory ownership is process-local; this
// does not certify PostgreSQL, installed consumers or session routing.
function countedStore() {
  const provider = createInMemoryClientToolExecutionStore();
  const counts = { acquire: 0, settle: 0 };
  const store: ToolExecutionStore = {
    acquire(key, invocation) {
      counts.acquire++;
      return provider.acquire(key, invocation);
    },
    settle(key, settlement) {
      counts.settle++;
      return provider.settle(key, settlement);
    },
  };
  return { store, counts };
}

function freshDefinition(call: ToolCall, handler: FunctionToolDefinition['handler'], idempotent = false) {
  const definition = captureTools({
    [call.name]: { description: 'Get weather for a location', handler, idempotent },
  }).definitions.get(call.name);
  if (!definition) throw new Error('Captured tool definition is missing');
  return definition;
}

function pendingCall(state: Awaited<ReturnType<typeof run>>): ToolCall {
  expect(state.next).toEqual([]);
  expect(calls(state)).toHaveLength(1);
  const call = calls(state)[0];
  expect(call).toMatchObject({
    id: expect.stringMatching(/\S/), name: 'get_weather', args: { location: 'Paris' },
  });
  expect(state.values.messages.filter((message) => message.type === 'tool')).toEqual([]);
  // The SDK helper types arguments as unknown. Preserve the backend's actual
  // ID, name and plain JSON arguments; only add the executor's pending status.
  return { ...call, args: call.args as PlainValue, status: 'pending' };
}

// A small protocol driver exposes the handoff boundary for every outcome. It
// uses the production buffer and only continues from the exact replay position
// when the executor returned a settled envelope. It is not session routing.
async function continueSettled(
  api: ReturnType<typeof client>,
  threadId: string,
  replayed: Awaited<ReturnType<typeof run>>,
  call: ToolCall,
  outcome: ToolExecutionOutcome,
  buffer: ReturnType<typeof createToolBuffer>,
) {
  if (outcome.type !== 'settled') return undefined;
  buffer.stage(call.id, outcome.result);
  return run(api, threadId, replayed.checkpoint, { messages: buffer.snapshot().messages });
}

test('checkpoint tool reuse: shared ownership reuses the exact envelope for graph continuation', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const pending = await run(api, threadId, undefined, input);
    const original = pendingCall(pending);
    const key = { threadId, toolCallId: original.id };
    const guard = countedStore();
    let handlers = 0;
    const value = { location: 'Paris', temperature: 68, unit: '°F', observations: ['clear', null], verified: true };
    const handler = (args: unknown) => {
      handlers++;
      expect(args).toEqual(original.args);
      return value;
    };
    const signal = new AbortController().signal;
    // An absent row authorizes this first execution. It does not establish
    // whether any earlier historical execution was covered by this guard.
    const first = await executeTool(freshDefinition(original, handler), original, signal, key, guard.store);
    expect(first).toEqual({ type: 'settled', result: { ok: true, value } });
    expect(handlers).toBe(1);
    expect(guard.counts).toEqual({ acquire: 1, settle: 1 });

    const before = await modelRequests();
    const replayed = await run(api, threadId, pending.checkpoint);
    expect(replayed.values).toEqual(pending.values);
    const replayCall = pendingCall(replayed);
    expect(replayCall).toEqual(original);
    expect(await modelRequests()).toBe(before);

    const reused = await executeTool(freshDefinition(replayCall, handler), replayCall, signal, key, guard.store);
    expect(handlers).toBe(1);
    expect(guard.counts).toEqual({ acquire: 2, settle: 1 });
    expect(reused).toEqual(first);
    expect(reused).toEqual({ type: 'settled', result: { ok: true, value } });
    const buffer = createToolBuffer();
    const completed = await continueSettled(api, threadId, replayed, replayCall, reused, buffer);
    if (!completed) throw new Error('Reusable result must continue the graph');
    const content = JSON.stringify(value);
    const message = {
      id: `client-tool-result-${original.id}`, role: 'tool', type: 'tool',
      tool_call_id: original.id, content,
    };
    expect(buffer.snapshot().messages).toEqual([message]);
    expect(completed.next).toEqual([]);
    expect(completed.values.messages.filter((entry) => entry.type === 'tool'))
      .toEqual([expect.objectContaining({ id: message.id, type: 'tool', tool_call_id: original.id, content })]);
    expect(completed.values.messages.at(-1)).toMatchObject({ type: 'ai', content: 'Protocol weather complete: Paris is 68°F.' });
    const continuation = (await modelJournal()).slice(before);
    expect(continuation).toHaveLength(1);
    // hasToolResult fixture matching alone would accept the wrong ID/content.
    expect(continuation[0].body?.messages?.filter((entry) => entry.role === 'tool'))
      .toEqual([expect.objectContaining({ role: 'tool', tool_call_id: original.id, content })]);
    expect(await api.threads.getState(threadId, pending.checkpoint)).toEqual(pending);
  } finally {
    await api.threads.delete(threadId);
  }
});

test('checkpoint tool reuse: an executing owner leaves its replay observer unavailable', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const pending = await run(api, threadId, undefined, input);
    const original = pendingCall(pending);
    const key = { threadId, toolCallId: original.id };
    const guard = countedStore();
    expect(await guard.store.acquire(key, canonicalInvocation(original.name, original.args)))
      .toEqual({ status: 'acquired', token: expect.stringMatching(/\S/) });
    const before = await modelRequests();
    const replayed = await run(api, threadId, pending.checkpoint);
    const call = pendingCall(replayed);
    expect(call).toEqual(original);
    let handlers = 0;
    const outcome = await executeTool(freshDefinition(call, () => { handlers++; return 'unexpected'; }), call, new AbortController().signal, key, guard.store);
    const buffer = createToolBuffer();
    const continued = await continueSettled(api, threadId, replayed, call, outcome, buffer);
    expect(handlers).toBe(0);
    expect(guard.counts).toEqual({ acquire: 2, settle: 0 });
    expect(outcome).toEqual({ type: 'unavailable', reason: 'outstanding' });
    expect(buffer.snapshot().messages).toEqual([]);
    expect(continued).toBeUndefined();
    expect(await modelRequests()).toBe(before);
    expect(await api.threads.getState(threadId, pending.checkpoint)).toEqual(pending);
  } finally {
    await api.threads.delete(threadId);
  }
});

test('checkpoint tool reuse: a non-JSON-exact owner result cannot be reused or handed off by replay', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const pending = await run(api, threadId, undefined, input);
    const original = pendingCall(pending);
    const key = { threadId, toolCallId: original.id };
    const guard = countedStore();
    let handlers = 0;
    const handler = () => { handlers++; return -0; };
    const signal = new AbortController().signal;
    const first = await executeTool(freshDefinition(original, handler), original, signal, key, guard.store);
    if (first.type !== 'settled' || !first.result.ok) throw new Error('Original owner must retain its exact result');
    expect(Object.is(first.result.value, -0)).toBe(true);
    expect(handlers).toBe(1);
    expect(guard.counts).toEqual({ acquire: 1, settle: 1 });
    const before = await modelRequests();
    const replayed = await run(api, threadId, pending.checkpoint);
    const call = pendingCall(replayed);
    expect(call).toEqual(original);
    const outcome = await executeTool(freshDefinition(call, handler), call, signal, key, guard.store);
    const buffer = createToolBuffer();
    const continued = await continueSettled(api, threadId, replayed, call, outcome, buffer);
    expect(handlers).toBe(1);
    expect(guard.counts).toEqual({ acquire: 2, settle: 1 });
    expect(outcome).toEqual({ type: 'unavailable', reason: 'outstanding' });
    expect(buffer.snapshot().messages).toEqual([]);
    expect(continued).toBeUndefined();
    expect(await modelRequests()).toBe(before);
    expect(await api.threads.getState(threadId, pending.checkpoint)).toEqual(pending);
  } finally {
    await api.threads.delete(threadId);
  }
});

test('checkpoint tool reuse: explicit idempotence preserves the existing helper bypass policy', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const pending = await run(api, threadId, undefined, input);
    const original = pendingCall(pending);
    const key = { threadId, toolCallId: original.id };
    const guard = countedStore();
    let handlers = 0;
    const handler = () => { handlers++; return '68°F'; };
    const signal = new AbortController().signal;
    const first = await executeTool(freshDefinition(original, handler, true), original, signal, key, guard.store);
    const before = await modelRequests();
    const replayed = await run(api, threadId, pending.checkpoint);
    const call = pendingCall(replayed);
    expect(call).toEqual(original);
    // Two explicit private-helper invocations, not a new replay command promise.
    const second = await executeTool(freshDefinition(call, handler, true), call, signal, key, guard.store);
    expect(first).toEqual({ type: 'settled', result: { ok: true, value: '68°F' } });
    expect(second).toEqual(first);
    expect(handlers).toBe(2);
    expect(guard.counts).toEqual({ acquire: 0, settle: 0 });
    expect(await modelRequests()).toBe(before);
  } finally {
    await api.threads.delete(threadId);
  }
});
