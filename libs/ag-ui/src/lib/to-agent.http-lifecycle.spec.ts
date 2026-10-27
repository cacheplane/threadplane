import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import {
  EventType, HttpAgent, type RunAgentInput, type RunStartedEvent, type RunFinishedEvent,
  type RunErrorEvent, type TextMessageStartEvent, type TextMessageContentEvent, type TextMessageEndEvent,
  type ReasoningMessageStartEvent, type ReasoningMessageContentEvent, type ReasoningMessageEndEvent,
  type SubagentStartedEvent, type SubagentFinishedEvent,
} from '@ag-ui/client';
import { completeDelivery, type Message } from '@threadplane/chat';
import { toAgent } from './to-agent';

const DEADLINE_MS = 2_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, milestone: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${milestone}`)), DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface HttpRun {
  method: string | undefined;
  input: RunAgentInput;
  response: ServerResponse;
  closed: ReturnType<typeof deferred<void>>;
  isClosed: boolean;
}

type SubmitResult = { status: 'fulfilled' } | { status: 'rejected'; reason: unknown };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Real loopback HTTP and the locked SDK decoder; fetch only captures its input. */
async function httpFixture() {
  const errors: unknown[] = [];
  const sockets = new Set<Socket>();
  const responses = new Set<ServerResponse>();
  const requests: HttpRun[] = [];
  const arrivals: Array<ReturnType<typeof deferred<HttpRun>>> = [];
  const contentEvents = new Map<string, ReturnType<typeof deferred<void>>>();
  const fetchCalls: RequestInit[] = [];
  const submissions: Promise<SubmitResult>[] = [];
  const cleanupState: { agent?: ReturnType<typeof toAgent>; unsubscribe?: () => void } = {};

  const server = createServer((request, response) => {
    responses.add(response);
    const closed = deferred<void>();
    let run: HttpRun | undefined;
    response.on('error', (error) => errors.push(error));
    response.once('close', () => {
      if (run) run.isClosed = true;
      responses.delete(response);
      closed.resolve();
    });
    request.on('error', (error) => errors.push(error));
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.once('end', () => {
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RunAgentInput;
        run = { method: request.method, input, response, closed, isClosed: false };
        requests.push(run);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.flushHeaders();
        arrivals[requests.length - 1]?.resolve(run);
      } catch (error) {
        errors.push(error);
        response.destroy();
      }
    });
  });
  server.on('error', (error) => errors.push(error));
  server.on('clientError', (error, socket) => {
    errors.push(error);
    socket.destroy();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  // Registered before listening, so assertion/setup failures also release resources.
  cleanups.push(async () => {
    cleanupState.agent?.dispose();
    cleanupState.unsubscribe?.();
    for (const response of responses) response.destroy();
    const stopped = new Promise<void>((resolve, reject) => {
      if (!server.listening) { resolve(); return; }
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const socket of sockets) socket.destroy();
    await within(Promise.all([stopped, ...submissions]), 'HTTP fixture teardown');
    expect(errors, 'unexpected local HTTP server errors').toEqual([]);
  });

  await within(new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  }), 'HTTP server listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP address');
  const realFetch = globalThis.fetch;
  const source = new HttpAgent({
    url: `http://127.0.0.1:${address.port}/agent`,
    threadId: 'http-lifecycle-thread',
    fetch: (url, init) => {
      fetchCalls.push(init);
      return realFetch(url, init);
    },
  });
  const subscription = source.subscribe({
    onTextMessageContentEvent({ event }) {
      contentEvents.get(event.messageId)?.resolve();
    },
  });
  cleanupState.unsubscribe = () => subscription.unsubscribe();
  const adapter = toAgent(source, { telemetry: false });
  cleanupState.agent = adapter;

  return {
    agent: adapter,
    fetchCalls,
    requests,
    submit(message: string) {
      // Attach both handlers immediately, including when a later assertion fails.
      const result = adapter.submit({ message }).then<SubmitResult, SubmitResult>(
        () => ({ status: 'fulfilled' }),
        (reason: unknown) => ({ status: 'rejected', reason }),
      );
      submissions.push(result);
      return result;
    },
    async request(index = 0) {
      if (requests[index]) return requests[index];
      const arrival = arrivals[index] ??= deferred<HttpRun>();
      return within(arrival.promise, `HTTP request ${index + 1}`);
    },
    async partial(run: HttpRun, messageId: string, text: string) {
      const observed = deferred<void>();
      contentEvents.set(messageId, observed);
      write(run, { type: EventType.RUN_STARTED, threadId: run.input.threadId, runId: run.input.runId });
      write(run, { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
      write(run, { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
      await within(observed.promise, `SDK text event for ${messageId}`);
      // onEvent can precede the adapter's asynchronous reduction. Cancellation
      // needs the visible partial answer, not just decoder notification.
      await vi.waitFor(() => {
        expect(answer(adapter, messageId)).toMatchObject({
          content: text, delivery: { phase: 'streaming' },
        });
      }, { timeout: DEADLINE_MS, interval: 10 });
    },
  };
}

type StreamEvent = RunStartedEvent | RunFinishedEvent | RunErrorEvent
  | TextMessageStartEvent | TextMessageContentEvent | TextMessageEndEvent
  | ReasoningMessageStartEvent | ReasoningMessageContentEvent | ReasoningMessageEndEvent
  | SubagentStartedEvent | SubagentFinishedEvent;

function write(run: HttpRun, event: StreamEvent): void {
  run.response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function finish(run: HttpRun, messageId: string): void {
  write(run, { type: EventType.TEXT_MESSAGE_END, messageId });
  write(run, { type: EventType.RUN_FINISHED, threadId: run.input.threadId, runId: run.input.runId });
  run.response.end();
}

function answer(agent: ReturnType<typeof toAgent>, id: string): Message {
  const message = agent.messages().find((message) => message.id === id);
  if (!message) throw new Error(`Expected visible answer ${id}`);
  return message;
}

function expectOpen(run: HttpRun, signal: AbortSignal | null | undefined): asserts signal is AbortSignal {
  expect(signal).toBeDefined();
  expect(signal?.aborted).toBe(false);
  expect(run.isClosed).toBe(false);
  expect(run.response.destroyed).toBe(false);
  expect(run.response.writableEnded).toBe(false);
}

describe('toAgent real HTTP lifecycle', () => {
  it('starts one POST only on submit and completes the exact streamed answer', async () => {
    const fixture = await httpFixture();
    const { agent } = fixture;
    expect(agent.messages()).toEqual([]);
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
    expect(agent.error()).toBeUndefined();
    expect(agent.state()).toEqual({});
    await agent.ready;
    expect(fixture.fetchCalls).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);

    const submitted = fixture.submit('Hello');
    const run = await fixture.request();
    expect(run.method).toBe('POST');
    expect(run.input.threadId).toBe('http-lifecycle-thread');
    expect(run.input.runId).toEqual(expect.any(String));
    expect(run.input.runId.length).toBeGreaterThan(0);
    expect(run.input.messages).toEqual([expect.objectContaining({ role: 'user', content: 'Hello' })]);
    await fixture.partial(run, 'answer', 'Hello ');
    const generation = answer(agent, 'answer').delivery.generation;
    write(run, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'answer', delta: 'world.' });
    finish(run, 'answer');

    expect(await within(submitted, 'successful submit settlement')).toEqual({ status: 'fulfilled' });
    expect(answer(agent, 'answer')).toMatchObject({
      role: 'assistant', content: 'Hello world.', delivery: completeDelivery(generation, 'success'),
    });
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
    expect(agent.error()).toBeUndefined();
    expect(fixture.fetchCalls).toHaveLength(1);
    expect(fixture.requests).toHaveLength(1);
  });

  it('retains interrupted delivery when HTTP ends gracefully without a terminal event', async () => {
    const fixture = await httpFixture();
    const submitted = fixture.submit('Continue');
    const run = await fixture.request();
    await fixture.partial(run, 'partial', 'Unfinished answer');
    const generation = answer(fixture.agent, 'partial').delivery.generation;
    expectOpen(run, fixture.fetchCalls[0].signal);
    run.response.end();

    expect(await within(submitted, 'unterminated submit settlement')).toEqual({ status: 'fulfilled' });
    expect(answer(fixture.agent, 'partial')).toMatchObject({
      content: 'Unfinished answer', delivery: completeDelivery(generation, 'interrupted'),
    });
    expect(fixture.agent.error()?.kind).toBe('interrupted');
    expect(fixture.agent.status()).toBe('error');
    expect(fixture.agent.isLoading()).toBe(false);
  });

  it('keeps parent and two child reasoning transcripts separate through actual SSE decoding', async () => {
    const fixture = await httpFixture();
    const { agent } = fixture;
    const submitted = fixture.submit('Delegate to two children');
    const run = await fixture.request();
    const children = [
      { id: 'child-one', reasoning: 'First child reasoning' },
      { id: 'child-two', reasoning: 'Second child reasoning' },
    ];
    write(run, { type: EventType.RUN_STARTED, threadId: run.input.threadId, runId: run.input.runId });
    write(run, { type: EventType.REASONING_MESSAGE_START, messageId: 'parent-message', role: 'reasoning' });
    write(run, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'parent-message', delta: 'Parent reasoning' });
    // Distinct wire IDs keep the stream valid for the locked SDK. Each child
    // reuses its own message ID for reasoning and the subsequent answer.
    for (const { id, reasoning } of children) {
      const messageId = `${id}-message`;
      write(run, { type: EventType.SUBAGENT_STARTED, subagentRunId: id, name: id });
      write(run, { type: EventType.REASONING_MESSAGE_START, subagentRunId: id, messageId, role: 'reasoning' });
      write(run, { type: EventType.REASONING_MESSAGE_CONTENT, subagentRunId: id, messageId, delta: reasoning });
      write(run, { type: EventType.REASONING_MESSAGE_END, subagentRunId: id, messageId });
    }
    for (const { id } of children) {
      const messageId = `${id}-message`;
      write(run, { type: EventType.TEXT_MESSAGE_START, subagentRunId: id, messageId, role: 'assistant' });
      write(run, { type: EventType.TEXT_MESSAGE_CONTENT, subagentRunId: id, messageId, delta: `${id} answer` });
      write(run, { type: EventType.TEXT_MESSAGE_END, subagentRunId: id, messageId });
      write(run, { type: EventType.SUBAGENT_FINISHED, subagentRunId: id, outcome: { type: 'success' } });
    }
    write(run, { type: EventType.REASONING_MESSAGE_END, messageId: 'parent-message' });
    write(run, { type: EventType.TEXT_MESSAGE_START, messageId: 'parent-message', role: 'assistant' });
    write(run, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'parent-message', delta: 'Parent answer' });
    finish(run, 'parent-message');

    expect(await within(submitted, 'parent and child submit settlement')).toEqual({ status: 'fulfilled' });
    expect(agent.messages().filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({
        id: 'parent-message', content: 'Parent answer', reasoning: 'Parent reasoning',
        delivery: completeDelivery(answer(agent, 'parent-message').delivery.generation, 'success'),
      }),
    ]);
    expect([...agent.subagents().keys()]).toEqual(['child-one', 'child-two']);
    for (const { id, reasoning } of children) {
      const child = agent.subagents().get(id);
      expect(child?.status()).toBe('complete');
      // Exactly one child slot contains both the reasoning and its answer.
      expect(child?.messages()).toEqual([
        expect.objectContaining({
          id: `${id}-message`, role: 'assistant', content: `${id} answer`, reasoning,
          delivery: expect.objectContaining({ phase: 'complete', outcome: 'success' }),
        }),
      ]);
    }
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
    expect(agent.error()).toBeUndefined();
    expect(run.method).toBe('POST');
    expect(fixture.fetchCalls).toHaveLength(1);
    expect(fixture.requests).toHaveLength(1);
  });

  it('retains the partial answer as an error after RUN_ERROR', async () => {
    const fixture = await httpFixture();
    const submitted = fixture.submit('Continue');
    const run = await fixture.request();
    await fixture.partial(run, 'partial', 'Before failure');
    const generation = answer(fixture.agent, 'partial').delivery.generation;
    write(run, { type: EventType.RUN_ERROR, message: 'Server could not finish', code: 'TEST_FAILURE' });
    run.response.end();

    expect(await within(submitted, 'errored submit settlement')).toEqual({ status: 'fulfilled' });
    expect(answer(fixture.agent, 'partial')).toMatchObject({
      content: 'Before failure', delivery: completeDelivery(generation, 'error'),
    });
    expect(fixture.agent.error()?.message).toBe('Server could not finish');
    expect(fixture.agent.status()).toBe('error');
    expect(fixture.agent.isLoading()).toBe(false);
  });

  it.each(['stop', 'dispose'] as const)('%s aborts the actual open HTTP request before teardown', async (action) => {
    const fixture = await httpFixture();
    const { agent } = fixture;
    const submitted = fixture.submit('Keep streaming');
    const run = await fixture.request();
    await fixture.partial(run, 'partial', 'Kept partial answer');
    const generation = answer(agent, 'partial').delivery.generation;
    const signal = fixture.fetchCalls[0].signal;
    expectOpen(run, signal);

    const cancelled = agent[action]();
    expect(signal.aborted, `${action} must abort the fetch signal synchronously`).toBe(true);
    await within(Promise.resolve(cancelled), `${action} settlement`);
    // This is observed before cleanup can destroy any response or socket.
    await within(run.closed.promise, `${action} must close the server response`);
    expect(run.isClosed).toBe(true);
    expect(run.response.writableEnded).toBe(false);
    expect(await within(submitted, 'aborted submit settlement')).toEqual({ status: 'fulfilled' });
    expect(answer(agent, 'partial')).toMatchObject({
      content: 'Kept partial answer', delivery: completeDelivery(generation, 'aborted'),
    });
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);

    if (action === 'dispose') {
      agent.dispose();
      const rejected = await within(fixture.submit('After disposal'), 'disposed submit rejection');
      expect(rejected).toMatchObject({ status: 'rejected', reason: new Error('Agent has been disposed') });
    }
    expect(fixture.fetchCalls).toHaveLength(1);
    expect(fixture.requests).toHaveLength(1);
  });

  it('stopping a second protocol run preserves the first successful answer and delivery', async () => {
    const fixture = await httpFixture();
    const { agent } = fixture;
    const firstSubmit = fixture.submit('First');
    const firstRun = await fixture.request();
    await fixture.partial(firstRun, 'first-answer', 'Completed first answer');
    finish(firstRun, 'first-answer');
    expect(await within(firstSubmit, 'first submit settlement')).toEqual({ status: 'fulfilled' });
    const firstAnswer = structuredClone(answer(agent, 'first-answer'));
    expect(firstAnswer.delivery).toEqual(completeDelivery(firstAnswer.delivery.generation, 'success'));

    const secondSubmit = fixture.submit('Second');
    const secondRun = await fixture.request(1);
    expect(secondRun.input.runId).not.toBe(firstRun.input.runId);
    expect(secondRun.input.threadId).toBe(firstRun.input.threadId);
    await fixture.partial(secondRun, 'second-answer', 'Partial second answer');
    const generation = answer(agent, 'second-answer').delivery.generation;
    const signal = fixture.fetchCalls[1].signal;
    expectOpen(secondRun, signal);
    const stopped = agent.stop();
    expect(signal.aborted).toBe(true);
    await within(stopped, 'second stop settlement');
    await within(secondRun.closed.promise, 'second server response closed before teardown');
    expect(await within(secondSubmit, 'second submit settlement')).toEqual({ status: 'fulfilled' });
    expect(answer(agent, 'first-answer')).toEqual(firstAnswer);
    expect(answer(agent, 'second-answer')).toMatchObject({
      content: 'Partial second answer', delivery: completeDelivery(generation, 'aborted'),
    });
    expect(agent.error()).toBeUndefined();
    expect(fixture.fetchCalls).toHaveLength(2);
    expect(fixture.requests).toHaveLength(2);
  });
});
