import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The shared wording is compared with its LangGraph source.
import { failureProjection } from '../../../langgraph/src/runtime/stream-projection';
import { AUTH_COPY } from './agent-session';
import { httpFailure } from './create-run';
import { createSession } from './create-session';

const sse = (...events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
/** A session whose responses the test supplies one request at a time. */
function scripted(
  responses: ((body: { threadId: string; runId: string }) => Response | Promise<Response>)[],
  tools = false
) {
  let index = 0;
  const options = {
    threadId: 'thread',
    url: 'https://failure.invalid/run',
    fetch: async (_url: unknown, init?: RequestInit) =>
      responses[index++](JSON.parse(String(init?.body))),
  };
  return tools
    ? createSession(options, {
        noop: { description: 'Nothing', handler: () => ({ done: true }) },
      })
    : createSession(options);
}
const rejected = (status: number, body = '{"detail":"Not allowed"}') => () =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });
const finished = (body: { threadId: string; runId: string }) =>
  sse(
    { type: 'RUN_STARTED', ...body },
    { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId }
  );

describe('httpFailure', () => {
  it('reads only a real HTTP status from a failed result', () => {
    const failed = (error: unknown) =>
      httpFailure({ outcome: 'error', error, fetchInvoked: true });
    expect(failed(Object.assign(new Error('HTTP 401'), { status: 401 }))).toEqual({ status: 401 });
    expect(Object.isFrozen(failed({ status: 503 }))).toBe(true);
    for (const error of [
      new Error('fetch failed'),
      { status: '401' },
      { status: 0 },
      { status: 600 },
      { status: 401.5 },
      { status: Number.NaN },
      null,
      'HTTP 401',
    ])
      expect(failed(error)).toBeUndefined();
    expect(
      httpFailure({ outcome: 'success', fetchInvoked: true })
    ).toBeUndefined();
  });
});

describe.each([
  ['without a client-tool catalog', false],
  ['with a client-tool catalog', true],
])('the failure cause %s', (_label, tools) => {
  it('keeps the status of a rejected response and clears it on the next run', async () => {
    const session = scripted([rejected(401), finished], tools);
    const view = session;
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot()).toMatchObject({
        status: 'error',
        run: { outcome: 'error', failure: { status: 401 } },
      });
      expect(Object.isFrozen(session.getSnapshot().run?.failure)).toBe(true);
      expect(view.getSnapshot().error).toEqual({
        kind: 'auth',
        message: AUTH_COPY,
        status: 401,
        retryable: false,
        recovery: 'none',
      });
      if (tools) {
        // A client-tool session refuses to continue after a failed run.
        expect(await session.submit('Again')).toBe('error');
        expect(view.getSnapshot().error?.status).toBe(401);
        return;
      }
      expect(await session.submit('Again')).toBe('success');
      expect(session.getSnapshot().run?.failure).toBeUndefined();
      expect('error' in view.getSnapshot()).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  it('reports another status as a server failure that carries it', async () => {
    const session = scripted([rejected(503, 'Unavailable')], tools);
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().run?.failure).toEqual({ status: 503 });
      expect(session.getSnapshot().error).toEqual({
        kind: 'server',
        message: 'The agent request failed.',
        status: 503,
        retryable: false,
        recovery: 'none',
      });
    } finally {
      await session.dispose();
    }
  });

  it('records no status when there was no response', async () => {
    const session = scripted(
      [
        () => {
          throw new TypeError('fetch failed');
        },
      ],
      tools
    );
    const view = session;
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().run?.failure).toBeUndefined();
      expect(view.getSnapshot().error).toMatchObject({
        kind: 'server',
        message: 'The agent request failed.',
      });
      expect('status' in view.getSnapshot().error!).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  it('records no status when the backend reported the error', async () => {
    const session = scripted(
      [
        (body) =>
          sse(
            { type: 'RUN_STARTED', ...body },
            { type: 'RUN_ERROR', message: 'Model overloaded' }
          ),
      ],
      tools
    );
    const view = session;
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().run?.failure).toBeUndefined();
      expect(view.getSnapshot().error).toMatchObject({
        kind: 'server',
        message: 'Model overloaded',
      });
      expect('status' in view.getSnapshot().error!).toBe(false);
    } finally {
      await session.dispose();
    }
  });
});

describe('the credential wording', () => {
  it('matches the LangGraph runtime', () => {
    expect(AUTH_COPY).toBe(
      failureProjection({ status: 403 }, false, false, false).message
    );
  });
});
