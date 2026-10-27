import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test, expect } from '@playwright/test';
import { Client, type Checkpoint } from '@langchain/langgraph-sdk';
import {
  backendUrl, calls, client, input, modelRequests, position, run,
  type CheckpointEvent, type State,
} from './checkpoint-protocol.helpers';

// This lane uses the published middleware from python/uv.lock (0.1.0), not a
// PYTHONPATH override to packages/threadplane-middleware. It proves the actual
// client-tools graph/API protocol, not browser tool execution or store claims.
test('checkpoint protocol: terminal replay preserves a pending call; pre-agent replay creates a new call', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const pending = await run(api, threadId, undefined, input);
    expect(pending.next).toEqual([]);
    expect(calls(pending)).toHaveLength(1);
    const original = calls(pending)[0];
    expect(original).toMatchObject({ id: expect.stringMatching(/\S/), name: 'get_weather', args: { location: 'Paris' } });
    const beforeAgent = (await api.threads.getHistory(threadId)).find((state) => state.next.includes('agent'));
    if (!beforeAgent) throw new Error('History must include a checkpoint before the agent runs');
    expect(calls(beforeAgent)).toEqual([]);

    const count = await modelRequests();
    const replayed = await run(api, threadId, pending.checkpoint);
    expect(replayed.next).toEqual([]);
    expect(replayed.values).toEqual(pending.values);
    expect(calls(replayed)).toEqual([original]);
    expect(await modelRequests()).toBe(count);

    const regenerated = await run(api, threadId, beforeAgent.checkpoint);
    expect(calls(regenerated)).toHaveLength(1);
    expect(calls(regenerated)[0]).toMatchObject({ id: expect.stringMatching(/\S/), name: original.name, args: original.args });
    expect(calls(regenerated)[0].id).not.toBe(original.id);
    expect(await modelRequests()).toBe(count + 1);

    const completed = await run(api, threadId, pending.checkpoint, {
      messages: [{ type: 'tool', tool_call_id: original.id, content: '68°F' }],
    });
    expect(completed.next).toEqual([]);
    expect(completed.values.messages.filter((message) => message.type === 'tool')).toMatchObject([{ tool_call_id: original.id }]);
    expect(completed.values.messages.at(-1)).toMatchObject({ type: 'ai', content: 'Protocol weather complete: Paris is 68°F.' });
    expect(await modelRequests()).toBe(count + 2);
    const completedReplay = await run(api, threadId, completed.checkpoint);
    expect(completedReplay.next).toEqual([]);
    expect(completedReplay.values).toEqual(completed.values);
    expect(await modelRequests()).toBe(count + 2);
  } finally {
    await api.threads.delete(threadId);
  }
});

test('checkpoint protocol: reconnect retains the run and routes a tool result through its exact final checkpoint', async () => {
  const requests: { path: string; method: string }[] = [];
  const api = new Client<State>({
    apiUrl: backendUrl(), apiKey: null, callerOptions: { maxRetries: 0 }, timeoutMs: 20_000,
    onRequest: (url, init) => {
      requests.push({ path: url.pathname, method: init.method ?? 'GET' });
      return init;
    },
  });
  const { thread_id: threadId } = await api.threads.create();
  const controller = new AbortController();
  try {
    let runId: string | undefined;
    let cursor: string | undefined;
    let disconnectedPosition: ReturnType<typeof position> | undefined;
    try {
      for await (const event of api.runs.stream(threadId, 'client-tools', {
        input, streamMode: ['values', 'checkpoints'], streamResumable: true,
        onDisconnect: 'continue', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      })) {
        expect(event.event).not.toBe('error');
        if (event.event === 'metadata') runId = event.data.run_id;
        if (event.event === 'checkpoints' && event.id && event.data.next.includes('agent')) {
          cursor = event.id;
          disconnectedPosition = position(event.data.config.configurable);
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
    if (!runId || !cursor || !disconnectedPosition) throw new Error('Disconnected stream must provide a run ID, checkpoint position and cursor');
    const checkpoints: CheckpointEvent[] = [];
    for await (const event of api.runs.joinStream(threadId, runId, {
      lastEventId: cursor, cancelOnDisconnect: false, streamMode: ['values', 'checkpoints'], signal: AbortSignal.timeout(20_000),
    })) {
      expect(event.event).not.toBe('error');
      expect(event.id).not.toBe(cursor);
      if (event.event === 'checkpoints') checkpoints.push(event as CheckpointEvent);
    }
    const final = checkpoints.at(-1);
    if (!final) throw new Error('Reconnected stream must emit a checkpoint event');
    const config = final.data.config.configurable;
    if (!config) throw new Error('Reconnected checkpoint must include routing configuration');
    expect(config['run_id']).toBe(runId);
    // Event metadata does not carry run_id; the retained config and the saved
    // checkpoint metadata are the two independently checked run identities.
    expect(final.data.metadata['run_id']).toBeUndefined();
    const exactPosition = position(config);
    expect(exactPosition.thread_id).toBe(threadId);
    expect(exactPosition.checkpoint_id).not.toBe(disconnectedPosition.checkpoint_id);
    const saved = await api.threads.getState(threadId, exactPosition);
    expect(saved.checkpoint.checkpoint_id).toBe(exactPosition.checkpoint_id);
    expect(saved.metadata?.['run_id']).toBe(runId);
    expect(saved.values).toEqual(final.data.values);
    expect(final.data.next).toEqual([]);
    expect(saved.next).toEqual([]);
    expect((await api.runs.get(threadId, runId)).status).toBe('success');

    const intermediate = await api.threads.getState(threadId, disconnectedPosition);
    expect(intermediate.checkpoint.checkpoint_id).toBe(disconnectedPosition.checkpoint_id);
    expect(calls(intermediate)).toEqual([]);
    expect(calls(saved)).toHaveLength(1);
    const pendingCall = calls(saved)[0];
    expect(pendingCall).toMatchObject({ id: expect.stringMatching(/\S/), name: 'get_weather', args: { location: 'Paris' } });
    const count = await modelRequests();
    const competingMessage = { id: 'reconnect-competitor', type: 'ai', content: 'Competing branch after reconnect.' };
    const competingPosition = position((await api.threads.updateState(threadId, {
      checkpoint: disconnectedPosition, values: { messages: [competingMessage] }, asNode: 'agent', signal: AbortSignal.timeout(10_000),
    })).configurable);
    expect(competingPosition.thread_id).toBe(threadId);
    expect(competingPosition.checkpoint_ns).toBe(disconnectedPosition.checkpoint_ns);
    const competitor = await api.threads.getState(threadId, competingPosition);
    expect(competitor.checkpoint.checkpoint_id).toBe(competingPosition.checkpoint_id);
    expect(competitor.parent_checkpoint?.checkpoint_id).toBe(disconnectedPosition.checkpoint_id);
    expect(competitor.values).toEqual({
      ...intermediate.values, messages: [...intermediate.values.messages, expect.objectContaining(competingMessage)],
    });
    // Latest proves the adversarial setup only; the following write retains
    // the joined run's final position as its authority.
    expect((await api.threads.getState(threadId)).checkpoint.checkpoint_id).toBe(competingPosition.checkpoint_id);

    // Protocol test data for the saved call, not an authored handler result.
    const terminalMessage = {
      id: 'reconnect-terminal-result', type: 'tool', tool_call_id: pendingCall.id,
      name: pendingCall.name, content: `Test terminal result for ${pendingCall.args['location']}.`,
    };
    const writtenPosition = position((await api.threads.updateState(threadId, {
      checkpoint: exactPosition, values: { messages: [terminalMessage] }, asNode: 'agent', signal: AbortSignal.timeout(10_000),
    })).configurable);
    expect(writtenPosition.thread_id).toBe(threadId);
    expect(writtenPosition.checkpoint_ns).toBe(exactPosition.checkpoint_ns);
    expect(new Set([
      disconnectedPosition.checkpoint_id, exactPosition.checkpoint_id,
      competingPosition.checkpoint_id, writtenPosition.checkpoint_id,
    ]).size).toBe(4);
    const written = await api.threads.getState(threadId, writtenPosition);
    expect(written.checkpoint.checkpoint_id).toBe(writtenPosition.checkpoint_id);
    // This graph always routes agent to END. next: [] alone cannot establish
    // that the write preserved the final pending call or its correct parent.
    expect(written.next).toEqual([]);
    expect(written.parent_checkpoint?.checkpoint_id).toBe(exactPosition.checkpoint_id);
    expect(written.values).toEqual({
      ...saved.values, messages: [...saved.values.messages, expect.objectContaining(terminalMessage)],
    });
    expect(calls(written)).toEqual([pendingCall]);
    expect(written.values.messages.some((message) => message.id === competingMessage.id)).toBe(false);
    expect(await api.threads.getState(threadId, disconnectedPosition)).toEqual(intermediate);
    expect(await api.threads.getState(threadId, exactPosition)).toEqual(saved);
    expect(await api.threads.getState(threadId, competingPosition)).toEqual(competitor);
    expect(await modelRequests()).toBe(count);
    expect(requests.filter((request) => request.method === 'POST' && /^\/threads\/[^/]+\/runs(?:\/stream|\/wait)?$/.test(request.path)))
      .toEqual([{ method: 'POST', path: `/threads/${threadId}/runs/stream` }]);
    expect(requests).toContainEqual({ method: 'GET', path: `/threads/${threadId}/runs/${runId}/stream` });
  } finally {
    controller.abort();
    await api.threads.delete(threadId);
  }
});

test('checkpoint protocol: a lost write response is ambiguous even with retries disabled', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  const accepted: Checkpoint[] = [];
  const competitors: Checkpoint[] = [];
  let parentPosition: Checkpoint | undefined;
  const ownedMessage = { id: 'lost-write-owned', type: 'ai', content: 'Accepted on owned branch.' };
  const competingMessage = { id: 'lost-write-competitor', type: 'ai', content: 'Newer competing branch.' };
  const proxyErrors: unknown[] = [];
  const proxyController = new AbortController();
  const handlers = new Set<Promise<void>>();
  let writeRequests = 0;
  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      expect(request.method).toBe('POST');
      expect(request.url).toBe(`/threads/${threadId}/state`);
      writeRequests++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const upstream = await fetch(`${backendUrl()}${request.url}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks),
        signal: AbortSignal.any([proxyController.signal, AbortSignal.timeout(10_000)]),
      });
      expect(upstream.status).toBe(200);
      const result = await upstream.json() as { configurable: Record<string, unknown> };
      accepted.push(position(result.configurable));
      if (!parentPosition) throw new Error('Parent must be captured before the request');
      competitors.push(position((await api.threads.updateState(threadId, {
        checkpoint: parentPosition, values: { messages: [competingMessage] }, asNode: 'agent',
        signal: AbortSignal.any([proxyController.signal, AbortSignal.timeout(5_000)]),
      })).configurable));
      // Upstream has accepted and returned the child position. Only this test
      // proxy knows it. A competing branch is now newer, and the caller receives
      // no successful response: neither its old position nor latest is safe.
      response.destroy();
    } catch (error) {
      proxyErrors.push(error);
      if (!response.destroyed) response.writeHead(500).end();
    }
  }
  const proxy = createServer((request, response) => {
    const handling = handleRequest(request, response);
    handlers.add(handling);
    void handling.then(
      () => handlers.delete(handling),
      (error) => { proxyErrors.push(error); handlers.delete(handling); response.destroy(); },
    );
  });
  try {
    const parent = await run(api, threadId, undefined, input);
    parentPosition = position(parent.checkpoint);
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Proxy did not bind a TCP port');
    const caller = new Client({
      apiUrl: `http://127.0.0.1:${address.port}`, apiKey: null,
      // Mirrors the owned session default; standalone SDK defaults differ.
      callerOptions: { maxRetries: 0 },
    });
    await expect(caller.threads.updateState(threadId, {
      checkpoint: parentPosition, values: { messages: [ownedMessage] }, asNode: 'agent', signal: AbortSignal.timeout(20_000),
    })).rejects.toThrow();
    expect(proxyErrors).toEqual([]);
    expect(writeRequests).toBe(1);
    expect(accepted).toHaveLength(1);
    expect(competitors).toHaveLength(1);
    expect(accepted[0].checkpoint_id).not.toBe(parent.checkpoint.checkpoint_id);
    expect(competitors[0].checkpoint_id).not.toBe(parent.checkpoint.checkpoint_id);
    expect(competitors[0].checkpoint_id).not.toBe(accepted[0].checkpoint_id);
    // Read the proxy-observed child, never the thread's global latest tip.
    const child = await api.threads.getState(threadId, accepted[0]);
    expect(child.checkpoint.checkpoint_id).toBe(accepted[0].checkpoint_id);
    expect(child.parent_checkpoint?.checkpoint_id).toBe(parent.checkpoint.checkpoint_id);
    expect(child.values.messages).toEqual([...parent.values.messages, expect.objectContaining(ownedMessage)]);
    expect(child.metadata?.['source']).toBe('update');
    const competitor = await api.threads.getState(threadId, competitors[0]);
    expect(competitor.parent_checkpoint?.checkpoint_id).toBe(parent.checkpoint.checkpoint_id);
    expect(competitor.values.messages).toEqual([...parent.values.messages, expect.objectContaining(competingMessage)]);
    // Demonstrate why a latest-tip reconciliation would adopt the wrong branch.
    // Neither exact read above obtains its position from this latest read.
    expect((await api.threads.getState(threadId)).checkpoint.checkpoint_id).toBe(competitors[0].checkpoint_id);
  } finally {
    proxyController.abort();
    const closed = proxy.listening ? new Promise<void>((resolve) => proxy.close(() => resolve())) : Promise.resolve();
    proxy.closeAllConnections();
    await closed;
    await Promise.allSettled([...handlers]);
    await api.threads.delete(threadId);
  }
});
