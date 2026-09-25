import { ok } from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { Message, RunAgentInput } from '@ag-ui/client';
import { createSession, type Session } from './create-session';
import type { SessionSnapshot } from './session-observation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Session HTTP milestone timed out')),
          2000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
interface Exchange {
  body: RunAgentInput;
  response: ServerResponse;
  closed: Promise<void>;
  send(...events: unknown[]): void;
}
async function serve() {
  const exchanges: Exchange[] = [];
  const arrivals = new Map<number, ReturnType<typeof deferred<Exchange>>>();
  const server = createServer(async (request, response) => {
    const closed = deferred<void>();
    response.on('close', () => closed.resolve());
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const exchange: Exchange = {
      body: JSON.parse(Buffer.concat(chunks).toString()),
      response,
      closed: closed.promise,
      send: (...events) => {
        for (const event of events)
          response.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    exchanges.push(exchange);
    arrivals.get(exchanges.length - 1)?.resolve(exchange);
  });
  server.listen(0, '127.0.0.1');
  await bounded(once(server, 'listening'));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/session`,
    exchanges,
    next: (index = 0) => {
      if (exchanges[index]) return Promise.resolve(exchanges[index]);
      const next = arrivals.get(index) ?? deferred<Exchange>();
      arrivals.set(index, next);
      return bounded(next.promise);
    },
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await bounded(closed);
    },
  };
}
function lifecycle(exchange: Exchange, type = 'RUN_STARTED') {
  return { type, threadId: exchange.body.threadId, runId: exchange.body.runId };
}
function envelope(
  owner: Session,
  text: string,
  previous: readonly Message[] = [],
  state: unknown = {},
  threadId = 'thread'
) {
  const value = owner.getSnapshot();
  return {
    threadId,
    runId: value.run?.id,
    state,
    messages: [
      ...previous,
      { id: value.transcript.at(-1)?.id, role: 'user', content: text },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}
function until(owner: Session, predicate: (value: SessionSnapshot) => boolean) {
  if (predicate(owner.getSnapshot())) return Promise.resolve();
  return bounded(
    new Promise<void>((resolve) => {
      const off = owner.subscribe(() => {
        if (predicate(owner.getSnapshot())) {
          off();
          resolve();
        }
      });
    })
  );
}

describe('composed private session over held HTTP', () => {
  it('retains all native families and sends an independent complete next envelope', async () => {
    const server = await serve();
    const owner = createSession({ threadId: 'thread', url: server.url });
    const observations: SessionSnapshot[] = [];
    owner.subscribe(() => observations.push(owner.getSnapshot()));
    const first = owner.submit('first');
    let second: Promise<unknown> | undefined;
    try {
      const exchange = await server.next();
      expect(exchange.body).toStrictEqual(envelope(owner, 'first'));
      const user = exchange.body.messages[0];
      exchange.send(
        lifecycle(exchange),
        {
          type: 'SUBAGENT_STARTED',
          subagentRunId: 'child',
          name: 'worker',
          metadata: { native: true },
        },
        {
          type: 'TEXT_MESSAGE_START',
          messageId: 'answer',
          role: 'assistant',
          name: 'named',
          subagentRunId: 'child',
          metadata: { text: [1] },
        },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: 'hello' },
        { type: 'TEXT_MESSAGE_END', messageId: 'answer' },
        {
          type: 'REASONING_MESSAGE_START',
          messageId: 'reason',
          role: 'reasoning',
        },
        {
          type: 'REASONING_MESSAGE_CONTENT',
          messageId: 'reason',
          delta: 'thinking',
        },
        { type: 'REASONING_MESSAGE_END', messageId: 'reason' },
        {
          type: 'TOOL_CALL_START',
          toolCallId: 'call',
          toolCallName: 'search',
          parentMessageId: 'answer',
          subagentRunId: 'child',
        },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'call', delta: '{"query":"x"}' },
        { type: 'TOOL_CALL_END', toolCallId: 'call' },
        {
          type: 'TOOL_CALL_RESULT',
          messageId: 'result',
          toolCallId: 'call',
          content: 'found',
          subagentRunId: 'executor',
          metadata: { result: true },
        },
        {
          type: 'ACTIVITY_SNAPSHOT',
          messageId: 'activity',
          activityType: 'progress',
          content: { count: 1 },
          subagentRunId: 'child',
        },
        {
          type: 'ACTIVITY_DELTA',
          messageId: 'activity',
          activityType: 'progress',
          patch: [{ op: 'replace', path: '/count', value: 2 }],
        },
        {
          type: 'REASONING_ENCRYPTED_VALUE',
          subtype: 'message',
          entityId: 'answer',
          encryptedValue: 'message-bytes',
        },
        {
          type: 'REASONING_ENCRYPTED_VALUE',
          subtype: 'tool-call',
          entityId: 'call',
          encryptedValue: 'call-bytes',
        },
        {
          type: 'STATE_SNAPSHOT',
          snapshot: { count: 1 },
          subagentRunId: 'child',
        },
        {
          type: 'STATE_DELTA',
          delta: [{ op: 'replace', path: '/count', value: 2 }],
          subagentRunId: 'other',
        },
        {
          type: 'SUBAGENT_FINISHED',
          subagentRunId: 'child',
          result: { child: true },
        }
      );
      await Promise.race([
        until(owner, (s) => !!s.subagents[0]?.terminal),
        first.then((outcome) => {
          throw new Error(
            `Premature ${outcome}: ${JSON.stringify(owner.getSnapshot())}`
          );
        }),
      ]);
      const beforeSnapshot = owner.getSnapshot();
      expect(beforeSnapshot.status).toBe('running');
      const answer = beforeSnapshot.transcript.find((m) => m.id === 'answer');
      const result = beforeSnapshot.transcript.find((m) => m.id === 'result');
      expect(answer).toStrictEqual({
        id: 'answer',
        role: 'assistant',
        content: 'hello',
        name: 'named',
        subagentRunId: 'child',
        metadata: { text: [1] },
        encryptedValue: 'message-bytes',
        toolCalls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"x"}' },
            encryptedValue: 'call-bytes',
          },
        ],
      });
      expect(result).toStrictEqual({
        id: 'result',
        role: 'tool',
        toolCallId: 'call',
        content: 'found',
        subagentRunId: 'executor',
        metadata: { result: true },
      });
      const retained = beforeSnapshot.transcript.filter(
        (m) => m.role === 'activity' || m.role === 'reasoning'
      );
      const terminal = {
        ...lifecycle(exchange, 'RUN_FINISHED'),
        result: { native: [1] },
        outcome: {
          type: 'interrupt',
          interrupts: [
            {
              id: 'approval',
              reason: 'confirm',
              message: 'Proceed?',
              toolCallId: 'call',
              subagentRunId: 'child',
              responseSchema: { type: 'boolean' },
              expiresAt: '2030-01-01',
              metadata: { native: [2] },
            },
          ],
        },
        timestamp: 123,
        metadata: { root: true },
      };
      exchange.send(
        { type: 'MESSAGES_SNAPSHOT', messages: [user, answer, result] },
        terminal
      );
      expect(await bounded(first)).toBe('paused');
      await bounded(exchange.closed);
      const settled = owner.getSnapshot();
      expect(settled.run?.terminal).toStrictEqual(terminal);
      expect(
        settled.transcript.filter(
          (m) => m.role === 'activity' || m.role === 'reasoning'
        )
      ).toEqual(retained);
      expect(settled.transcript.find((m) => m.role === 'reasoning')).toBe(
        retained.find((m) => m.role === 'reasoning')
      );
      expect(settled.state).toEqual({ count: 2 });
      second = owner.submit('second');
      const next = await server.next(1);
      expect(next.body).toStrictEqual({
        threadId: 'thread',
        runId: owner.getSnapshot().run?.id,
        state: { count: 2 },
        messages: [
          ...settled.transcript.filter((m) => m.role !== 'activity'),
          {
            id: owner.getSnapshot().transcript.at(-1)?.id,
            role: 'user',
            content: 'second',
          },
        ],
        tools: [],
        context: [],
        forwardedProps: {},
      });
      expect(next.body.runId).not.toBe(exchange.body.runId);
      expect(
        new Set(
          [...exchange.body.messages, ...next.body.messages].map((m) => m.id)
        ).size
      ).toBe(next.body.messages.length);
      expect(owner.getSnapshot().subagents).toEqual([]);
      expect(owner.getSnapshot().run?.terminal).toBeUndefined();
      next.send(lifecycle(next), lifecycle(next, 'RUN_FINISHED'));
      expect(await bounded(second)).toBe('success');
      await bounded(next.closed);
      expect(observations[0].transcript).toEqual([user]);
      expect(beforeSnapshot.run?.terminal).toBeUndefined();
      expect(settled.run?.outcome).toBe('paused');
      expect(server.exchanges).toHaveLength(2);
    } finally {
      await owner.dispose();
      await Promise.all([first, second]);
      await server.close();
    }
  });

  it.each([
    ['success', 'success'],
    ['legacy', 'paused'],
    ['error', 'error'],
    ['EOF', 'interrupted'],
    ['state-patch', 'error'],
    ['SDK-reject', 'error'],
    ['foreign', 'error'],
    ['duplicate', 'error'],
  ] as const)(
    'settles %s once without retry or invented native terminal',
    async (ending, expected) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      const done = owner.submit('one');
      try {
        const exchange = await server.next();
        expect(exchange.body).toStrictEqual(envelope(owner, 'one'));
        const initialTranscript = owner.getSnapshot().transcript;
        exchange.send(lifecycle(exchange));
        if (ending === 'EOF' || ending === 'error')
          exchange.send({
            type: 'SUBAGENT_STARTED',
            subagentRunId: 'open',
            name: 'worker',
          });
        let terminal: unknown;
        if (ending === 'success')
          terminal = {
            ...lifecycle(exchange, 'RUN_FINISHED'),
            outcome: { type: 'success' },
            result: false,
          };
        if (ending === 'legacy')
          terminal = {
            type: 'CUSTOM',
            name: 'on_interrupt',
            value: '[{"literal":true}]',
          };
        if (ending === 'error')
          terminal = {
            type: 'RUN_ERROR',
            message: 'provider failed',
            code: 'E_PROVIDER',
            metadata: { detail: [1] },
          };
        if (terminal) exchange.send(terminal);
        else if (ending === 'EOF') exchange.response.end();
        else if (ending === 'state-patch')
          exchange.send({
            type: 'STATE_DELTA',
            delta: [{ op: 'remove', path: '/missing' }],
          });
        else if (ending === 'SDK-reject')
          exchange.send({
            type: 'TEXT_MESSAGE_CONTENT',
            messageId: 'missing',
            delta: 'invalid sequence',
          });
        else if (ending === 'foreign')
          exchange.send({
            ...lifecycle(exchange, 'RUN_FINISHED'),
            threadId: 'foreign',
          });
        else
          exchange.send({
            type: 'MESSAGES_SNAPSHOT',
            messages: [
              {
                id: 'x',
                role: 'assistant',
                toolCalls: [
                  {
                    id: 'same',
                    type: 'function',
                    function: { name: 'f', arguments: '' },
                  },
                ],
              },
              {
                id: 'y',
                role: 'assistant',
                toolCalls: [
                  {
                    id: 'same',
                    type: 'function',
                    function: { name: 'f', arguments: '' },
                  },
                ],
              },
            ],
          });
        expect(await bounded(done)).toBe(expected);
        await bounded(exchange.closed);
        expect(owner.getSnapshot().run?.terminal).toStrictEqual(terminal);
        expect(owner.getSnapshot().run?.outcome).toBe(expected);
        expect(owner.getSnapshot().status).toBe(
          expected === 'error' || expected === 'interrupted' ? 'error' : 'idle'
        );
        expect(owner.getSnapshot().transcript).toBe(initialTranscript);
        if (ending === 'EOF' || ending === 'error')
          expect(owner.getSnapshot().subagents).toEqual([
            {
              started: {
                type: 'SUBAGENT_STARTED',
                subagentRunId: 'open',
                name: 'worker',
              },
            },
          ]);
        expect(server.exchanges).toHaveLength(1);
      } finally {
        await owner.dispose();
        await done;
        await server.close();
      }
    }
  );

  it.each(['stop', 'dispose', 'external', 'replace'] as const)(
    'closes held %s work and isolates a second owner',
    async (command) => {
      const server = await serve();
      const a = createSession({ threadId: 'a', url: server.url });
      const b = createSession({ threadId: 'b', url: server.url });
      const aSeen: SessionSnapshot[] = [];
      const bSeen: SessionSnapshot[] = [];
      a.subscribe(() => aSeen.push(a.getSnapshot()));
      b.subscribe(() => bSeen.push(b.getSnapshot()));
      const signal = new AbortController();
      const first = a.submit('a', { signal: signal.signal });
      const second = b.submit('b');
      let replacement: Promise<unknown> | undefined;
      try {
        const exchanges = await Promise.all([server.next(), server.next(1)]);
        const ae = exchanges.find((e) => e.body.threadId === 'a');
        ok(ae);
        const be = exchanges.find((e) => e.body.threadId === 'b');
        ok(be);
        expect(ae.body).toStrictEqual(envelope(a, 'a', [], {}, 'a'));
        expect(be.body).toStrictEqual(envelope(b, 'b', [], {}, 'b'));
        expect(ae.body.runId).not.toBe(be.body.runId);
        expect(ae.body.messages[0].id).not.toBe(be.body.messages[0].id);
        ae.send(lifecycle(ae), {
          type: 'STATE_SNAPSHOT',
          snapshot: { owner: 'a' },
        });
        be.send(lifecycle(be), {
          type: 'STATE_SNAPSHOT',
          snapshot: { owner: 'b' },
        });
        await Promise.all([
          until(a, (s) => JSON.stringify(s.state) === '{"owner":"a"}'),
          until(b, (s) => JSON.stringify(s.state) === '{"owner":"b"}'),
        ]);
        const bBefore = b.getSnapshot();
        const bCount = bSeen.length;
        const aborted = new AbortController();
        aborted.abort();
        expect(await a.submit('preaborted', { signal: aborted.signal })).toBe(
          'aborted'
        );
        expect(a.getSnapshot().status).toBe('running');
        if (command === 'external') signal.abort();
        else if (command === 'replace') replacement = a.submit('replacement');
        else await bounded(a[command]());
        expect(await bounded(first)).toBe('aborted');
        await bounded(ae.closed);
        const aAfter = a.getSnapshot();
        const aCount = aSeen.length;
        ae.send(
          { type: 'STATE_SNAPSHOT', snapshot: { stale: true } },
          lifecycle(ae, 'RUN_FINISHED')
        );
        expect(b.getSnapshot()).toBe(bBefore);
        expect(bSeen).toHaveLength(bCount);
        be.send(lifecycle(be, 'RUN_FINISHED'));
        expect(await bounded(second)).toBe('success');
        await bounded(be.closed);
        expect(a.getSnapshot()).toBe(aAfter);
        expect(aSeen).toHaveLength(aCount);
        if (replacement) {
          const fresh = await server.next(2);
          expect(fresh.body).toStrictEqual(
            envelope(a, 'replacement', ae.body.messages, { owner: 'a' }, 'a')
          );
          fresh.send(lifecycle(fresh), lifecycle(fresh, 'RUN_FINISHED'));
          expect(await bounded(replacement)).toBe('success');
          await bounded(fresh.closed);
        }
        expect(server.exchanges).toHaveLength(replacement ? 3 : 2);
        if (command === 'dispose') {
          const last = a.getSnapshot();
          let notified = false;
          a.subscribe(() => {
            notified = true;
          });
          expect(await a.submit('ignored')).toBe('aborted');
          expect(a.getSnapshot()).toBe(last);
          expect(notified).toBe(false);
        }
      } finally {
        await Promise.all([a.dispose(), b.dispose()]);
        await Promise.all([first, second, replacement]);
        await server.close();
      }
    }
  );

  const seed: Message[] = [
    {
      id: 'a',
      role: 'assistant',
      content: 'old',
      subagentRunId: 'owner',
      toolCalls: [
        { id: 'c', type: 'function', function: { name: 'f', arguments: '' } },
      ],
    },
    {
      id: 'result',
      role: 'tool',
      toolCallId: 'c',
      content: 'old',
      subagentRunId: 'executor',
    },
    {
      id: 'activity',
      role: 'activity',
      activityType: 'p',
      content: { count: 0 },
      subagentRunId: 'owner',
    },
  ];
  it('ignores a tagged activity delta aimed at retained nonactivity history without input echo', async () => {
    const server = await serve();
    const owner = createSession({
      threadId: 'thread',
      url: server.url,
      messages: seed,
    });
    const done = owner.submit('one');
    try {
      const exchange = await server.next();
      expect(exchange.body).toStrictEqual(
        envelope(
          owner,
          'one',
          seed.filter((m) => m.role !== 'activity')
        )
      );
      const previous = owner.getSnapshot().transcript;
      exchange.send(
        lifecycle(exchange),
        {
          type: 'ACTIVITY_DELTA',
          messageId: 'a',
          activityType: 'p',
          patch: [],
          subagentRunId: 'different',
        },
        lifecycle(exchange, 'RUN_FINISHED')
      );
      expect(await bounded(done)).toBe('success');
      await bounded(exchange.closed);
      expect(owner.getSnapshot().transcript).toBe(previous);
    } finally {
      await owner.dispose();
      await done;
      await server.close();
    }
  });
  it.each([
    {
      type: 'TEXT_MESSAGE_START',
      messageId: 'a',
      role: 'assistant',
      subagentRunId: 'other',
    },
    {
      type: 'TOOL_CALL_START',
      toolCallId: 'c',
      toolCallName: 'f',
      subagentRunId: 'other',
    },
    {
      type: 'TOOL_CALL_START',
      toolCallId: 'new',
      parentMessageId: 'a',
      toolCallName: 'f',
      subagentRunId: 'other',
    },
    {
      type: 'ACTIVITY_DELTA',
      messageId: 'activity',
      activityType: 'p',
      patch: [{ op: 'replace', path: '/count', value: 1 }],
      subagentRunId: 'other',
    },
    {
      type: 'TOOL_CALL_RESULT',
      messageId: 'result',
      toolCallId: 'c',
      content: 'changed',
      subagentRunId: 'owner',
    },
  ])(
    'rejects retained $type ownership conflict on second submit without input echo',
    async (event) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      const first = owner.submit('one');
      let second: Promise<unknown> | undefined;
      try {
        const e = await server.next();
        expect(e.body).toStrictEqual(envelope(owner, 'one'));
        e.send(
          lifecycle(e),
          { type: 'MESSAGES_SNAPSHOT', messages: seed },
          lifecycle(e, 'RUN_FINISHED')
        );
        expect(await bounded(first)).toBe('success');
        await bounded(e.closed);
        second = owner.submit('two');
        const next = await server.next(1);
        const previous = owner.getSnapshot().transcript;
        expect(next.body).toStrictEqual(
          envelope(
            owner,
            'two',
            seed.filter((m) => m.role !== 'activity')
          )
        );
        next.send(lifecycle(next), event);
        expect(await bounded(second)).toBe('error');
        await bounded(next.closed);
        expect(owner.getSnapshot().transcript).toBe(previous);
        expect(owner.getSnapshot().run?.terminal).toBeUndefined();
        expect(server.exchanges).toHaveLength(2);
      } finally {
        await owner.dispose();
        await Promise.all([first, second]);
        await server.close();
      }
    }
  );

  it.each([
    'matching',
    'untagged',
    'authoritative',
    'untagged-then-explicit',
  ] as const)(
    'second submit %s follows retained admission and upstream limits without input echo',
    async (mode) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      const first = owner.submit('one');
      let second: Promise<unknown> | undefined;
      try {
        const e = await server.next();
        expect(e.body).toStrictEqual(envelope(owner, 'one'));
        e.send(
          lifecycle(e),
          { type: 'MESSAGES_SNAPSHOT', messages: seed },
          lifecycle(e, 'RUN_FINISHED')
        );
        expect(await bounded(first)).toBe('success');
        await bounded(e.closed);
        second = owner.submit('two');
        const next = await server.next(1);
        expect(next.body).toStrictEqual(
          envelope(
            owner,
            'two',
            seed.filter((m) => m.role !== 'activity')
          )
        );
        next.send(lifecycle(next));
        const tag =
          mode === 'matching'
            ? { subagentRunId: 'owner' }
            : mode === 'authoritative'
            ? { subagentRunId: 'new' }
            : {};
        if (mode === 'authoritative')
          next.send({
            type: 'MESSAGES_SNAPSHOT',
            messages: [
              {
                id: 'a',
                role: 'assistant',
                content: 'replaced',
                subagentRunId: 'new',
              },
            ],
          });
        next.send(
          {
            type: 'TEXT_MESSAGE_START',
            messageId: 'a',
            role: 'assistant',
            ...tag,
          },
          {
            type: 'TEXT_MESSAGE_CONTENT',
            messageId: 'a',
            delta: '+',
            ...(mode === 'untagged-then-explicit'
              ? { subagentRunId: 'owner' }
              : tag),
          },
          { type: 'TEXT_MESSAGE_END', messageId: 'a', ...tag },
          lifecycle(next, 'RUN_FINISHED')
        );
        expect(await bounded(second)).toBe(
          mode === 'untagged-then-explicit' ? 'error' : 'success'
        );
        await bounded(next.closed);
        expect(
          owner.getSnapshot().transcript.find((m) => m.id === 'a')?.content
        ).toBe(
          mode === 'authoritative'
            ? 'replaced+'
            : mode === 'untagged-then-explicit'
            ? 'old'
            : 'old+'
        );
      } finally {
        await owner.dispose();
        await Promise.all([first, second]);
        await server.close();
      }
    }
  );
  it.each(['matching', 'untagged'] as const)(
    'second submit %s tool reopening preserves issuer and distinct result executor',
    async (mode) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      const first = owner.submit('one');
      let second: Promise<unknown> | undefined;
      try {
        const e = await server.next();
        expect(e.body).toStrictEqual(envelope(owner, 'one'));
        e.send(
          lifecycle(e),
          { type: 'MESSAGES_SNAPSHOT', messages: seed },
          lifecycle(e, 'RUN_FINISHED')
        );
        expect(await bounded(first)).toBe('success');
        await bounded(e.closed);
        second = owner.submit('two');
        const next = await server.next(1);
        expect(next.body).toStrictEqual(
          envelope(
            owner,
            'two',
            seed.filter((m) => m.role !== 'activity')
          )
        );
        const tag = mode === 'matching' ? { subagentRunId: 'owner' } : {};
        next.send(
          lifecycle(next),
          {
            type: 'TOOL_CALL_START',
            toolCallId: 'c',
            toolCallName: 'f',
            ...tag,
          },
          { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: 'literal', ...tag },
          { type: 'TOOL_CALL_END', toolCallId: 'c', ...tag },
          {
            type: 'TOOL_CALL_RESULT',
            messageId: 'result',
            toolCallId: 'c',
            content: 'updated',
            subagentRunId: 'executor',
          },
          lifecycle(next, 'RUN_FINISHED')
        );
        expect(await bounded(second)).toBe('success');
        await bounded(next.closed);
        expect(
          owner.getSnapshot().transcript.find((m) => m.id === 'a')
        ).toMatchObject({
          subagentRunId: 'owner',
          toolCalls: [{ function: { arguments: 'literal' } }],
        });
        expect(
          owner.getSnapshot().transcript.find((m) => m.id === 'result')
        ).toMatchObject({ subagentRunId: 'executor', content: 'updated' });
      } finally {
        await owner.dispose();
        await Promise.all([first, second]);
        await server.close();
      }
    }
  );
});
