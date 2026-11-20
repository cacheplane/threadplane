import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CONNECTION_COPY } from './agent-session';
import { createSession } from './create-session';
import { PROTECTED_COPY } from './session-instruments';

/** What the AG-UI example's error-handling e2e accepts for an unreachable host. */
const SHOWN = /can't reach|connection|server|interrupted|try again/i;
const CONNECTION = {
  kind: 'connection',
  message: CONNECTION_COPY,
  retryable: false,
  recovery: 'none',
};
type Send = (url: unknown, init?: RequestInit) => Promise<Response>;
function sessionOver(fetch: Send, tools: boolean, extra = {}) {
  const options = {
    threadId: 'thread',
    url: 'https://unreachable.invalid/run',
    fetch: fetch as typeof globalThis.fetch,
    ...extra,
  };
  return tools
    ? createSession(options, {
        noop: { description: 'Nothing', handler: () => ({ done: true }) },
      })
    : createSession(options);
}
/** A `fetch` that fails as a runtime does when no response arrives. */
const failing =
  (failure: () => unknown): Send =>
  async () => {
    throw failure();
  };
/** Node: the reason is a code on the failure's cause. */
const refused = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
      code: 'ECONNREFUSED',
    }),
  });

describe.each([
  ['without a handler map', false],
  ['with a handler map', true],
])('a request that got no response, %s', (_label, tools) => {
  it.each([
    ['Chromium', () => new TypeError('Failed to fetch')],
    [
      'Firefox',
      () => new TypeError('NetworkError when attempting to fetch resource.'),
    ],
    ['WebKit', () => new TypeError('Load failed')],
    ['React Native', () => new TypeError('Network request failed')],
    ['Node, connection refused', refused],
    [
      'Node, name not found',
      () =>
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND nowhere'), {
            code: 'ENOTFOUND',
          }),
        }),
    ],
  ])('is a connection error with the connection wording: %s', async (_name, failure) => {
    const session = sessionOver(failing(failure), tools);
    try {
      expect(await session.submit('Go')).toBe('error');
      const failed = session.getSnapshot();
      expect(failed.error).toEqual(CONNECTION);
      expect(failed.error?.message).toMatch(SHOWN);
      expect(failed.error?.message).toBe(
        "Can't reach the server. Check your connection and try again."
      );
      expect(failed.run?.failure).toBeUndefined();
      // The thrown value is still described beside the error.
      expect(failed.errorDiagnostic).toMatchObject({ name: 'TypeError' });
      // Whether the request left is not known, so it is not sent again.
      if (!session.retry) throw new Error('The session has no retry.');
      await expect(session.retry()).rejects.toThrow(/cannot be retried/);
    } finally {
      await session.dispose();
    }
  });

  it('is cleared by the next run', async () => {
    let calls = 0;
    const session = sessionOver(async (_url, init) => {
      if (calls++ === 0) throw new TypeError('Failed to fetch');
      const body = JSON.parse(String(init?.body));
      return new Response(
        [
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    }, false);
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error?.kind).toBe('connection');
      expect(await session.submit('Again')).toBe('success');
      expect(session.getSnapshot().error).toBeUndefined();
    } finally {
      await session.dispose();
    }
  });

  it('keeps a connection that dropped after the response began a server error', async () => {
    const session = sessionOver(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(
                new TypeError('terminated', {
                  cause: Object.assign(new Error('other side closed'), {
                    code: 'UND_ERR_SOCKET',
                  }),
                })
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        ),
      tools
    );
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error).toEqual({
        kind: 'server',
        message: 'The agent request failed.',
        retryable: false,
        recovery: 'none',
      });
    } finally {
      await session.dispose();
    }
  });

  it('keeps a backend RUN_ERROR that uses the same words a server error', async () => {
    const session = sessionOver(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        [
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          { type: 'RUN_ERROR', message: 'Failed to fetch the weather' },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    }, tools);
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error).toMatchObject({
        kind: 'server',
        message: 'Failed to fetch the weather',
      });
    } finally {
      await session.dispose();
    }
  });

  it('keeps a response that was not OK a status error', async () => {
    const session = sessionOver(
      async () => new Response('Failed to fetch', { status: 502 }),
      tools
    );
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error).toMatchObject({
        kind: 'server',
        status: 502,
      });
    } finally {
      await session.dispose();
    }
  });

  it('shows a protected session its one message', async () => {
    const reportOperationFailure = vi.fn();
    const session = sessionOver(failing(refused), tools, {
      reportOperationFailure,
    });
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error).toMatchObject({
        kind: 'server',
        message: PROTECTED_COPY,
      });
    } finally {
      await session.dispose();
    }
  });
});

describe('a host that refuses the connection', () => {
  it('is a connection error over the real fetch', async () => {
    // A port that was just released: nothing listens there.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    const session = createSession({
      threadId: 'thread',
      url: `http://127.0.0.1:${port}/agent`,
    });
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error).toEqual(CONNECTION);
    } finally {
      await session.dispose();
    }
  });
});

describe('a client agent whose transport got no response', () => {
  it('is a connection error too', async () => {
    const session = createSession({
      threadId: 'thread',
      agent: {
        run: () =>
          new Observable((subscriber) =>
            subscriber.error(new TypeError('Failed to fetch'))
          ),
      } as never,
    });
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error).toEqual(CONNECTION);
    } finally {
      await session.dispose();
    }
  });
});
