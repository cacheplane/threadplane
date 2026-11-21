import type { RunAgentInput } from '@ag-ui/client';
import { contentBlocksText, onAgentStateUpdate } from '@threadplane/core';
import { describe, expect, it } from 'vitest';
import { createSession } from './create-session';
import { bindingFixture } from './testing/binding-fixture';
import { memoryStore } from './testing/memory-store';

type Exchange = Awaited<
  ReturnType<ReturnType<typeof bindingFixture>['started']>
>;
const finish = (exchange: Exchange, outcome?: object) =>
  exchange.emit({
    type: 'RUN_FINISHED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
    ...(outcome && { outcome }),
  });
const pauseOutcome = {
  type: 'interrupt',
  interrupts: [{ id: 'approval', reason: 'Approve' }],
};
const yes = [
  { interruptId: 'approval', status: 'resolved' as const, value: { ok: true } },
];

/** A fetch that answers each request with the events `script` returns for it. */
function scripted(
  script: (input: RunAgentInput, index: number) => readonly object[] | number
) {
  const requests: RunAgentInput[] = [];
  const fetch = async (_url: unknown, init?: { body?: unknown }) => {
    const input = JSON.parse(String(init?.body)) as RunAgentInput;
    const answer = script(input, requests.push(input) - 1);
    if (typeof answer === 'number')
      return new Response('refused', { status: answer });
    return new Response(
      answer.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } }
    );
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}
const started = (input: RunAgentInput) => ({
  type: 'RUN_STARTED',
  threadId: input.threadId,
  runId: input.runId,
});
const finished = (input: RunAgentInput, outcome?: object) => ({
  type: 'RUN_FINISHED',
  threadId: input.threadId,
  runId: input.runId,
  ...(outcome && { outcome }),
});

describe('structured content', () => {
  it('sends submitted blocks as protocol parts and publishes them back', async () => {
    const fixture = bindingFixture();
    try {
      const blocks = [
        { type: 'text' as const, text: 'What is this?' },
        { type: 'image' as const, url: 'https://example.invalid/cat.png' },
      ];
      const run = fixture.session.submit({ message: 'What is this?', blocks });
      const exchange = await fixture.started();
      expect(exchange.body.messages).toEqual([
        {
          id: expect.any(String),
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image',
              source: { type: 'url', value: 'https://example.invalid/cat.png' },
            },
          ],
        },
      ]);
      finish(exchange);
      expect(await run).toBe('success');
      const [message] = fixture.session.getSnapshot().messages;
      expect(message.blocks).toEqual(blocks);
      expect(message.content).toBe(contentBlocksText(blocks));
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses a block a user message cannot carry, without sending', async () => {
    const fixture = bindingFixture();
    try {
      expect(
        await fixture.session.submit({
          message: 'x',
          blocks: [{ type: 'tool_use', id: 'c', name: 'f', args: {} }],
        })
      ).toBe('error');
      expect(fixture.exchanges).toHaveLength(0);
      expect(fixture.session.getSnapshot().messages).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('tool calls', () => {
  it('lists a call whose arguments are streaming, then moves it to toolCalls', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Weather?');
      const exchange = await fixture.started();
      const seen = fixture.changed(
        (snapshot) =>
          snapshot.streamingToolCalls?.[0]?.argsText === '{"city":"Pa'
      );
      exchange.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'call',
        toolCallName: 'get_weather',
        parentMessageId: 'a',
      });
      exchange.emit({
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'call',
        delta: '{"city":"Pa',
      });
      const streaming = await seen;
      expect(streaming.streamingToolCalls).toEqual([
        {
          id: 'call',
          name: 'get_weather',
          argsText: '{"city":"Pa',
          args: { city: 'Pa' },
        },
      ]);
      expect(streaming.toolCalls).toEqual([]);
      expect(Object.isFrozen(streaming.streamingToolCalls)).toBe(true);
      // The same snapshot keeps the same list.
      expect(fixture.session.getSnapshot().streamingToolCalls).toBe(
        streaming.streamingToolCalls
      );

      const final = fixture.changed(
        (snapshot) => snapshot.toolCalls.length > 0
      );
      exchange.emit({
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'call',
        delta: 'ris"}',
      });
      const done = await final;
      expect(done).not.toHaveProperty('streamingToolCalls');
      expect(done.toolCalls).toEqual([
        {
          id: 'call',
          name: 'get_weather',
          args: { city: 'Paris' },
          status: 'running',
        },
      ]);
      finish(exchange);
      await run;
    } finally {
      await fixture.cleanup();
    }
  });

  it('reads partial arguments back to the last complete member', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Go');
      const exchange = await fixture.started();
      const read = async (delta: string) => {
        const before = fixture.session.getSnapshot().streamingToolCalls?.[0];
        const next = fixture.changed(
          (snapshot) => snapshot.streamingToolCalls?.[0] !== before
        );
        exchange.emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta });
        return (await next).streamingToolCalls?.[0];
      };
      exchange.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'c',
        toolCallName: 'plan',
        parentMessageId: 'a',
      });
      await fixture.changed(
        (snapshot) => snapshot.streamingToolCalls?.length === 1
      );
      expect(await read('{"a"')).toMatchObject({ argsText: '{"a"', args: {} });
      expect(await read(':1,"b":[1,')).toMatchObject({
        args: { a: 1, b: [1] },
      });
      expect(await read('{"c":"x\\')).toMatchObject({
        argsText: '{"a":1,"b":[1,{"c":"x\\',
        args: { a: 1, b: [1, { c: 'x\\' }] },
      });
      await fixture.session.stop();
      await run;
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps the parts of a result sent as parts', async () => {
    const parts = [
      { type: 'text', text: '{"temp":20}' },
      {
        type: 'image',
        source: { type: 'url', value: 'https://example.invalid/map.png' },
      },
    ];
    const session = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
      messages: [
        { id: 'u', role: 'user', content: 'Weather?' },
        {
          id: 'a',
          role: 'assistant',
          toolCalls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'get_weather', arguments: '{}' },
            },
          ],
        },
        { id: 't', role: 'tool', toolCallId: 'call', content: parts } as never,
      ],
    });
    const snapshot = session.getSnapshot();
    expect(snapshot.toolCalls).toEqual([
      {
        id: 'call',
        name: 'get_weather',
        args: {},
        status: 'complete',
        result: { temp: 20 },
        parts,
      },
    ]);
    // The tool message carries the same content as blocks.
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: '{"temp":20}',
      blocks: [
        { type: 'text', text: '{"temp":20}' },
        { type: 'image', url: 'https://example.invalid/map.png' },
      ],
    });
    await session.dispose();
  });
});

describe('errorDiagnostic', () => {
  it('describes the backend RUN_ERROR beside the error', async () => {
    const fixture = bindingFixture();
    try {
      expect(fixture.session.getSnapshot()).not.toHaveProperty(
        'errorDiagnostic'
      );
      const run = fixture.session.submit('Go');
      const exchange = await fixture.started();
      exchange.emit({
        type: 'RUN_ERROR',
        message: 'Quota spent',
        code: 'quota',
      });
      expect(await run).toBe('error');
      const snapshot = fixture.session.getSnapshot();
      expect(snapshot.error?.message).toBe('Quota spent');
      expect(snapshot.errorDiagnostic).toEqual({
        name: 'RunError',
        message: 'Quota spent',
        code: 'quota',
      });
      expect(Object.isFrozen(snapshot.errorDiagnostic)).toBe(true);
      // The next run clears both.
      const again = fixture.session.retry?.();
      finish(await fixture.started(1));
      expect(await again).toBe('success');
      expect(fixture.session.getSnapshot()).not.toHaveProperty(
        'errorDiagnostic'
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('describes what the transport failed with, and nothing when protected', async () => {
    const refusing = scripted(() => 503);
    const open = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
      fetch: refusing.fetch,
    });
    expect(await open.submit('Go')).toBe('error');
    const diagnostic = open.getSnapshot().errorDiagnostic;
    expect(diagnostic).toMatchObject({ status: 503 });
    expect(typeof diagnostic?.message).toBe('string');
    expect(diagnostic instanceof Error).toBe(false);
    await open.dispose();

    const guarded = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
      fetch: refusing.fetch,
      reportOperationFailure: () => undefined,
    });
    expect(await guarded.submit('Go')).toBe('error');
    expect(guarded.getSnapshot().error).toBeDefined();
    expect(guarded.getSnapshot()).not.toHaveProperty('errorDiagnostic');
    await guarded.dispose();
  });
});

describe('child agents from activity records', () => {
  it('publishes the child state and a pending status', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Research');
      const exchange = await fixture.started();
      const pending = fixture.changed(
        (snapshot) => snapshot.subagents[0]?.status === 'pending'
      );
      exchange.emit({
        type: 'ACTIVITY_SNAPSHOT',
        messageId: 'child',
        activityType: 'subagent',
        content: { name: 'researcher', status: 'pending', toolCallId: 'call' },
      });
      expect((await pending).subagents[0]).not.toHaveProperty('state');
      const running = fixture.changed(
        (snapshot) => snapshot.subagents[0]?.status === 'running'
      );
      exchange.emit({
        type: 'ACTIVITY_DELTA',
        messageId: 'child',
        activityType: 'subagent',
        patch: [
          { op: 'replace', path: '/status', value: 'running' },
          { op: 'add', path: '/state', value: { step: 2, notes: ['a'] } },
        ],
      });
      const child = (await running).subagents[0];
      expect(child.state).toEqual({ step: 2, notes: ['a'] });
      expect(Object.isFrozen(child.state)).toBe(true);
      // The evidence it was read from is still there.
      expect(child.activity?.['state']).toBe(child.state);
      finish(exchange);
      await run;
      // No ending was seen: the child is unknown once the run is over.
      expect(fixture.session.getSnapshot().subagents[0].status).toBe('unknown');
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('resume options', () => {
  it('sends a message and a state patch in the same request as the answers', async () => {
    const fixture = bindingFixture({ state: { draft: 1 } });
    const session = fixture.session;
    try {
      const paused = session.submit('Go');
      finish(await fixture.started(), pauseOutcome);
      expect(await paused).toBe('paused');
      const answered = session.resume(yes, {
        message: 'Approved, continue',
        state: { reviewer: 'Ada' },
      });
      const exchange = await fixture.started(1);
      expect(exchange.body.resume).toEqual([
        { interruptId: 'approval', status: 'resolved', payload: { ok: true } },
      ]);
      expect(exchange.body.state).toEqual({ draft: 1, reviewer: 'Ada' });
      expect(
        exchange.body.messages.map(({ role, content }) => [role, content])
      ).toEqual([
        ['user', 'Go'],
        ['user', 'Approved, continue'],
      ]);
      finish(exchange);
      expect(await answered).toBe('success');
      expect(session.getSnapshot().state).toEqual({
        draft: 1,
        reviewer: 'Ada',
      });
      expect(session.getSnapshot().messages.map((m) => m.content)).toEqual([
        'Go',
        'Approved, continue',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('sends blocks with the answers, with a client-tool catalog too', async () => {
    const backend = scripted((input, index) =>
      index === 0
        ? [started(input), finished(input, pauseOutcome)]
        : [started(input), finished(input)]
    );
    const session = createSession(
      { url: 'https://agent.invalid', threadId: 't', fetch: backend.fetch },
      {}
    );
    expect(await session.submit('Go')).toBe('paused');
    expect(
      await session.resume(yes, {
        blocks: [{ type: 'image', url: 'https://example.invalid/proof.png' }],
        state: { reviewer: 'Ada' },
      })
    ).toBe('success');
    const sent = backend.requests[1];
    expect(sent.resume).toHaveLength(1);
    expect(sent.state).toEqual({ reviewer: 'Ada' });
    expect(sent.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'url', value: 'https://example.invalid/proof.png' },
        },
      ],
    });
    await session.dispose();
  });

  it('rejects an option it cannot send, without claiming the pause', async () => {
    const fixture = bindingFixture();
    try {
      const paused = fixture.session.submit('Go');
      finish(await fixture.started(), pauseOutcome);
      await paused;
      await expect(
        fixture.session.resume(yes, { state: [] as never })
      ).rejects.toThrow('Application state must be a plain record');
      expect(fixture.exchanges).toHaveLength(1);
      expect(fixture.session.getSnapshot().interrupts).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('retry of an answer the backend refused', () => {
  for (const tools of [false, true])
    it(`sends the same answer again ${
      tools ? 'with' : 'without'
    } a client-tool catalog`, async () => {
      const backend = scripted((input, index) =>
        index === 0
          ? [started(input), finished(input, pauseOutcome)]
          : index === 1
          ? // Refused before any run started.
            [{ type: 'RUN_ERROR', message: 'Busy, try again' }]
          : [started(input), finished(input)]
      );
      const options = {
        url: 'https://agent.invalid',
        threadId: 't',
        fetch: backend.fetch,
      };
      const session = tools
        ? createSession(options, {})
        : createSession(options);
      expect(await session.submit('Go')).toBe('paused');
      expect(
        await session.resume(yes, {
          message: 'Approved',
          state: { reviewer: 'Ada' },
        })
      ).toBe('error');
      const failed = session.getSnapshot();
      expect(failed.error).toMatchObject({
        message: 'Busy, try again',
        retryable: true,
        recovery: 'retry',
      });
      // The pause is pending again: nothing took the answer.
      expect(failed.interrupts).toHaveLength(1);
      expect(failed.decision).not.toHaveProperty('attempt');

      expect(await session.retry?.()).toBe('success');
      expect(backend.requests).toHaveLength(3);
      const [, refused, sent] = backend.requests;
      expect(sent.resume).toEqual(refused.resume);
      expect(sent.state).toEqual(refused.state);
      expect(sent.messages).toEqual(refused.messages);
      expect(sent.runId).not.toBe(refused.runId);
      const settled = session.getSnapshot();
      expect(settled.error).toBeUndefined();
      expect(settled.decision).toBeUndefined();
      // The message was appended once.
      expect(settled.messages.map((message) => message.content)).toEqual([
        'Go',
        'Approved',
      ]);
      await session.dispose();
    });

  it('never resends an answer whose run started before it failed', async () => {
    const backend = scripted((input, index) =>
      index === 0
        ? [started(input), finished(input, pauseOutcome)]
        : [started(input), { type: 'RUN_ERROR', message: 'Crashed' }]
    );
    const session = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
      fetch: backend.fetch,
    });
    expect(await session.submit('Go')).toBe('paused');
    expect(await session.resume(yes)).toBe('error');
    expect(session.getSnapshot().error?.recovery).toBe('none');
    expect(session.getSnapshot().decision).toHaveProperty('attempt');
    await expect(session.retry?.()).rejects.toThrow('cannot be retried');
    expect(backend.requests).toHaveLength(2);
    await session.dispose();
  });

  it('does not take a refused response without a RUN_ERROR as proof', async () => {
    const backend = scripted((input, index) =>
      index === 0 ? [started(input), finished(input, pauseOutcome)] : 503
    );
    const session = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
      fetch: backend.fetch,
    });
    expect(await session.submit('Go')).toBe('paused');
    expect(await session.resume(yes)).toBe('error');
    expect(session.getSnapshot().error?.recovery).toBe('none');
    await expect(session.retry?.()).rejects.toThrow('cannot be retried');
    await session.dispose();
  });
});

describe('runWithoutMessage', () => {
  it('runs on the conversation as it stands, after merging the state', async () => {
    const fixture = bindingFixture({
      messages: [{ id: 'u', role: 'user', content: 'Earlier' }],
      state: { a: 1 },
    });
    try {
      const run = fixture.session.runWithoutMessage?.({ state: { b: 2 } });
      const exchange = await fixture.started();
      expect(exchange.body.messages).toEqual([
        { id: 'u', role: 'user', content: 'Earlier' },
      ]);
      expect(exchange.body.state).toEqual({ a: 1, b: 2 });
      finish(exchange);
      expect(await run).toBe('success');
      expect(fixture.session.getSnapshot().messages).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('is refused while a decision is waiting, and retried after a RUN_ERROR', async () => {
    const fixture = bindingFixture();
    try {
      const failed = fixture.session.runWithoutMessage?.();
      (await fixture.started()).emit({ type: 'RUN_ERROR', message: 'No' });
      expect(await failed).toBe('error');
      const again = fixture.session.retry?.();
      const second = await fixture.started(1);
      expect(second.body.messages).toEqual([]);
      finish(second, pauseOutcome);
      expect(await again).toBe('paused');
      expect(await fixture.session.runWithoutMessage?.()).toBe('error');
      expect(fixture.exchanges).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it('is on a session with a client-tool catalog too', async () => {
    const backend = scripted((input) => [started(input), finished(input)]);
    const session = createSession(
      { url: 'https://agent.invalid', threadId: 't', fetch: backend.fetch },
      {}
    );
    expect(await session.runWithoutMessage?.({ state: { n: 1 } })).toBe(
      'success'
    );
    expect(backend.requests[0].messages).toEqual([]);
    expect(backend.requests[0].state).toEqual({ n: 1 });
    await session.dispose();
  });
});

describe('clientTools', () => {
  const spec = {
    name: 'pick_seat',
    description: 'Asks the person to pick a seat.',
    parameters: { type: 'object', properties: { row: { type: 'number' } } },
  };
  const callFor = (exchange: Exchange, id: string, name = 'pick_seat') => {
    exchange.emit({
      type: 'TOOL_CALL_START',
      toolCallId: id,
      toolCallName: name,
      parentMessageId: 'a',
    });
    exchange.emit({
      type: 'TOOL_CALL_ARGS',
      toolCallId: id,
      delta: '{"row":4}',
    });
    exchange.emit({ type: 'TOOL_CALL_END', toolCallId: id });
  };

  it('sends the catalog, lists the pending call, and continues on resolve', async () => {
    const fixture = bindingFixture();
    const session = fixture.session;
    try {
      const tools = session.clientTools;
      if (!tools) throw new Error('Missing capability');
      // Nothing is listed before a catalog is declared.
      expect(session.getSnapshot()).not.toHaveProperty('pendingClientTools');
      tools.setCatalog([spec]);
      expect(session.getSnapshot().pendingClientTools).toEqual([]);

      const run = session.submit('Book');
      const first = await fixture.started();
      expect(first.body.tools).toEqual([spec]);
      const called = fixture.changed(
        (snapshot) => snapshot.toolCalls.length > 0
      );
      callFor(first, 'c1');
      // Not actionable while the run is going.
      expect((await called).pendingClientTools).toEqual([]);
      finish(first);
      expect(await run).toBe('success');
      const waiting = session.getSnapshot();
      expect(waiting.pendingClientTools).toEqual([
        { id: 'c1', name: 'pick_seat', args: { row: 4 }, status: 'pending' },
      ]);
      expect(waiting.pendingClientTools?.[0]).toBe(waiting.toolCalls[0]);

      tools.resolve('c1', { ok: true, value: { seat: '4A' } });
      const settled = session.getSnapshot();
      expect(settled.pendingClientTools).toEqual([]);
      expect(settled.toolCalls[0]).toMatchObject({
        status: 'complete',
        result: { seat: '4A' },
      });
      const second = await fixture.started(1);
      // The continuation carries the result and no new user message.
      expect(second.body.messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'tool',
      ]);
      expect(second.body.messages.at(-1)).toEqual({
        id: 'tool-c1',
        role: 'tool',
        toolCallId: 'c1',
        content: '{"seat":"4A"}',
      });
      expect(second.body.tools).toEqual([spec]);
      finish(second);
      await fixture.changed((snapshot) => snapshot.status === 'idle');
    } finally {
      await fixture.cleanup();
    }
  });

  it('settles without running, records a failure, and rejects an unknown id', async () => {
    const fixture = bindingFixture();
    const session = fixture.session;
    try {
      const tools = session.clientTools;
      if (!tools?.settle) throw new Error('Missing capability');
      tools.setCatalog([spec, { ...spec, name: 'confirm' }]);
      const run = session.submit('Book');
      const first = await fixture.started();
      callFor(first, 'c1');
      callFor(first, 'c2', 'confirm');
      // A call to a tool the caller did not declare is not the caller's to answer.
      callFor(first, 'c3', 'server_side');
      finish(first);
      await run;
      expect(
        session.getSnapshot().pendingClientTools?.map((call) => call.id)
      ).toEqual(['c1', 'c2']);

      expect(() => tools.settle?.('c3', { ok: true, value: 1 })).toThrow(
        'No pending client tool call has the id c3.'
      );
      tools.settle('c1', { ok: false, error: 'Dismissed' });
      expect(fixture.exchanges).toHaveLength(1);
      const [failed] = session.getSnapshot().toolCalls;
      expect(failed).toMatchObject({ status: 'error', error: 'Dismissed' });
      expect(
        session.getSnapshot().pendingClientTools?.map((call) => call.id)
      ).toEqual(['c2']);
      expect(() => tools.settle?.('c1', { ok: true, value: 1 })).toThrow();
      await tools.flush?.();

      tools.settle('c2', { ok: true, value: 'yes' });
      const next = session.submit('Thanks');
      const second = await fixture.started(1);
      expect(
        second.body.messages
          .filter((message) => message.role === 'tool')
          .map((message) => [
            message.toolCallId,
            message.content,
            (message as { error?: string }).error,
          ])
      ).toEqual([
        ['c1', 'Error: Dismissed', 'Dismissed'],
        ['c2', 'yes', undefined],
      ]);
      finish(second);
      await next;
    } finally {
      await fixture.cleanup();
    }
  });

  it('lists only the calls the backend names when it names them', async () => {
    const fixture = bindingFixture();
    try {
      fixture.session.clientTools?.setCatalog([spec]);
      const run = fixture.session.submit('Book');
      const first = await fixture.started();
      callFor(first, 'c1');
      callFor(first, 'c2');
      finish(first, { type: 'success', pendingToolCallIds: ['c2'] });
      await run;
      expect(
        fixture.session.getSnapshot().pendingClientTools?.map((call) => call.id)
      ).toEqual(['c2']);
      // An empty catalog declares no tools.
      fixture.session.clientTools?.setCatalog([]);
      expect(fixture.session.getSnapshot().pendingClientTools).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('flush saves the thread that holds the settled result', async () => {
    const memory = memoryStore();
    const fixture = bindingFixture({
      persistence: { namespace: 'n', store: memory.store },
    });
    const session = fixture.session;
    try {
      await session.ready;
      session.clientTools?.setCatalog([spec]);
      const run = session.submit('Book');
      const first = await fixture.started();
      callFor(first, 'c1');
      finish(first);
      await run;
      session.clientTools?.settle?.('c1', { ok: true, value: { seat: '4A' } });
      await session.clientTools?.flush?.();
      expect(
        memory
          .record('n', 'native-thread')
          ?.messages.some((message) => message.id === 'tool-c1')
      ).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('is left undefined on a session that runs its own handlers', async () => {
    const session = createSession(
      { url: 'https://agent.invalid', threadId: 't' },
      { f: { description: 'f', handler: () => 1 } }
    );
    expect('clientTools' in session).toBe(false);
    expect(session.getSnapshot()).not.toHaveProperty('pendingClientTools');
    expect(session.getSnapshot().clientTools.calls).toEqual([]);
    await session.dispose();
  });
});

describe('state_update events', () => {
  it('reach the core render-store helper', async () => {
    const fixture = bindingFixture();
    try {
      const updates: unknown[] = [];
      const release = onAgentStateUpdate(fixture.session, (update) =>
        updates.push(update)
      );
      const run = fixture.session.submit('Render');
      const exchange = await fixture.started();
      exchange.emit({
        type: 'CUSTOM',
        name: 'state_update',
        value: { '/title': 'Trip', '/days': 3 },
      });
      // A JSON string is read as its data, as the Angular adapter read it.
      exchange.emit({
        type: 'CUSTOM',
        name: 'state_update',
        value: '{"/days":4}',
      });
      exchange.emit({ type: 'CUSTOM', name: 'other', value: { x: 1 } });
      finish(exchange);
      await run;
      expect(updates).toEqual([
        { '/title': 'Trip', '/days': 3 },
        { '/days': 4 },
      ]);
      release();
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('lifecycle', () => {
  it('records each milestone once, in the LangGraph session shape', async () => {
    const fixture = bindingFixture();
    const session = fixture.session;
    try {
      const lifecycle = session.lifecycle;
      if (!lifecycle) throw new Error('Missing lifecycle');
      const empty = lifecycle.getSnapshot();
      expect(empty).toEqual({
        streamStartedAt: null,
        streamErrorAt: null,
        interruptReceivedAt: null,
        interruptResolvedAt: null,
        threadCreatedAt: null,
        threadPersistedAt: null,
        toolCallStartedAt: null,
        toolCallCompletedAt: null,
      });
      expect(lifecycle.getSnapshot()).toBe(empty);
      let notified = 0;
      const release = lifecycle.subscribe(() => notified++);

      const paused = session.submit('Go');
      const first = await fixture.started();
      first.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'c',
        toolCallName: 'search',
        parentMessageId: 'a',
      });
      first.emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '{}' });
      first.emit({ type: 'TOOL_CALL_END', toolCallId: 'c' });
      first.emit({
        type: 'TOOL_CALL_RESULT',
        messageId: 'r',
        toolCallId: 'c',
        content: 'ok',
      });
      finish(first, pauseOutcome);
      expect(await paused).toBe('paused');
      const afterPause = lifecycle.getSnapshot();
      expect(afterPause.streamStartedAt).toEqual(expect.any(Number));
      expect(afterPause.toolCallStartedAt).toEqual(expect.any(Number));
      expect(afterPause.toolCallCompletedAt).toEqual(expect.any(Number));
      expect(afterPause.interruptReceivedAt).toEqual(expect.any(Number));
      expect(afterPause.interruptResolvedAt).toBeNull();
      // The thread was given, so this session did not create it.
      expect(afterPause.threadCreatedAt).toBeNull();
      expect(Object.isFrozen(afterPause)).toBe(true);
      expect(notified).toBeGreaterThan(0);

      const answered = session.resume(yes);
      const second = await fixture.started(1);
      expect(lifecycle.getSnapshot().interruptResolvedAt).toEqual(
        expect.any(Number)
      );
      second.emit({ type: 'RUN_ERROR', message: 'Down' });
      expect(await answered).toBe('error');
      expect(lifecycle.getSnapshot().streamErrorAt).toEqual({
        at: expect.any(Number),
        kind: 'server',
      });
      expect(lifecycle.getSnapshot().streamStartedAt).toBe(
        afterPause.streamStartedAt
      );
      release();
      await session.dispose();
      const before = notified;
      lifecycle.subscribe(() => notified++);
      expect(notified).toBe(before);
    } finally {
      await fixture.cleanup();
    }
  });

  it('marks the thread a session named itself, and a restored thread', async () => {
    const backend = scripted((input) => [started(input), finished(input)]);
    const own = createSession({
      url: 'https://agent.invalid',
      fetch: backend.fetch,
    });
    expect(own.lifecycle?.getSnapshot().threadCreatedAt).toBeNull();
    await own.submit('Go');
    expect(own.lifecycle?.getSnapshot().threadCreatedAt).toEqual(
      expect.any(Number)
    );
    await own.dispose();

    const restored = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
      replay: async () => [
        { type: 'RUN_STARTED', threadId: 't', runId: 'r' } as never,
        { type: 'RUN_FINISHED', threadId: 't', runId: 'r' } as never,
      ],
    });
    expect(restored.lifecycle?.getSnapshot().threadPersistedAt).toBeNull();
    await restored.ready;
    expect(restored.lifecycle?.getSnapshot().threadPersistedAt).toEqual(
      expect.any(Number)
    );
    await restored.dispose();
  });
});

describe('load', () => {
  it('is absent on a session with nothing to load', async () => {
    const session = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
    });
    expect(session.load).toBeUndefined();
    await session.dispose();
  });

  it('reads the thread again and holds the session meanwhile', async () => {
    let history: object[] = [];
    let release: (() => void) | undefined;
    let held = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = createSession({
      url: 'https://agent.invalid',
      threadId: 't',
      replay: async () => {
        if (held) await gate;
        return history as never;
      },
    });
    await session.ready;
    expect(session.getSnapshot().messages).toEqual([]);
    expect(session.getSnapshot().inputBlocked).toBeUndefined();

    history = [
      {
        type: 'RUN_STARTED',
        threadId: 't',
        runId: 'r',
        input: {
          threadId: 't',
          runId: 'r',
          messages: [{ id: 'u', role: 'user', content: 'From elsewhere' }],
        },
      },
      { type: 'TEXT_MESSAGE_START', messageId: 'a', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Hello' },
      { type: 'TEXT_MESSAGE_END', messageId: 'a' },
      { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
    ];
    held = true;
    const loading = session.load?.();
    // A thread-loading indicator reads this.
    expect(session.getSnapshot().inputBlocked?.reason).toBe('hydrating');
    // The same load is returned while it is going, and nothing else runs.
    expect(session.load?.()).toBe(loading);
    expect(await session.submit('Too early')).toBe('error');
    release?.();
    await loading;
    expect(session.getSnapshot().inputBlocked).toBeUndefined();
    expect(session.getSnapshot().messages.map((m) => m.content)).toEqual([
      'From elsewhere',
      'Hello',
    ]);
    await session.dispose();
    await expect(session.load?.()).rejects.toThrow('disposed');
  });

  it('reloads from storage and keeps the declared catalog', async () => {
    const memory = memoryStore();
    const persistence = { namespace: 'n', store: memory.store };
    const writer = bindingFixture({ persistence });
    await writer.session.ready;
    const reader = bindingFixture({ persistence });
    try {
      await reader.session.ready;
      reader.session.clientTools?.setCatalog([]);
      const run = writer.session.submit('Saved elsewhere');
      const exchange = await writer.started();
      finish(exchange);
      await run;
      await writer.session.clientTools?.flush?.();
      expect(reader.session.getSnapshot().messages).toEqual([]);
      await reader.session.load?.();
      expect(
        reader.session.getSnapshot().messages.map((m) => m.content)
      ).toEqual(['Saved elsewhere']);
      expect(reader.session.getSnapshot().pendingClientTools).toEqual([]);
      // A load is refused while a run is going.
      const going = reader.session.submit('Next');
      await reader.started();
      await expect(reader.session.load?.()).rejects.toThrow(
        'Stop the active request'
      );
      await reader.session.stop();
      await going;
    } finally {
      await writer.cleanup();
      await reader.cleanup();
    }
  });
});
