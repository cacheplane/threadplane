import { describe, expect, it, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { postX } from './post.ts';
import { XAuth } from './auth.ts';
import type { Draft } from '../types.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let origEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  origEnv = { ...process.env };
  Object.assign(process.env, {
    X_CLIENT_ID: 'cid',
    X_CLIENT_SECRET: 'csec',
    X_ACCESS_TOKEN: 'access-1',
    X_REFRESH_TOKEN: 'refresh-1',
    X_USER_HANDLE: 'brian',
  });
});
afterEach(() => {
  process.env = origEnv;
});

describe('postX', () => {
  it('posts a single tweet with no media', async () => {
    let receivedBody: unknown;
    server.use(
      mswHttp.post('https://api.x.com/2/tweets', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ data: { id: '1001', text: 'hello' } });
      }),
    );
    const auth = new XAuth();
    const draft: Draft = { channel: 'x', text: 'hello' };
    const result = await postX(auth, draft);
    expect(receivedBody).toEqual({ text: 'hello' });
    expect(result.postId).toBe('1001');
    expect(result.url).toBe('https://x.com/brian/status/1001');
    expect(result.channel).toBe('x');
  });

  it('posts a single tweet with media (uploads first, attaches media_ids)', async () => {
    let mediaCalls = 0;
    let metadataCalls = 0;
    let tweetBody: { text: string; media?: { media_ids: string[] } } | undefined;
    server.use(
      mswHttp.post('https://api.x.com/2/media/upload', () => {
        mediaCalls++;
        return HttpResponse.json({ data: { id: 'media-7', media_key: 'mk' } });
      }),
      mswHttp.post('https://api.x.com/2/media/metadata', () => {
        metadataCalls++;
        return HttpResponse.json({ data: { ok: true } });
      }),
      mswHttp.post('https://api.x.com/2/tweets', async ({ request }) => {
        tweetBody = (await request.json()) as typeof tweetBody;
        return HttpResponse.json({ data: { id: '1002', text: 'hi' } });
      }),
    );
    const auth = new XAuth();
    const draft: Draft = {
      channel: 'x',
      text: 'hi',
      media: [{ png: Buffer.from('a'), alt: 'alt-1' }],
    };
    const result = await postX(auth, draft);
    expect(mediaCalls).toBe(1);
    expect(metadataCalls).toBe(1);
    expect(tweetBody).toEqual({ text: 'hi', media: { media_ids: ['media-7'] } });
    expect(result.postId).toBe('1002');
  });

  it('posts a thread with 3 parts, chaining reply.in_reply_to_tweet_id', async () => {
    const tweetBodies: { text: string; reply?: { in_reply_to_tweet_id: string } }[] = [];
    let counter = 100;
    server.use(
      mswHttp.post('https://api.x.com/2/tweets', async ({ request }) => {
        const body = (await request.json()) as (typeof tweetBodies)[0];
        tweetBodies.push(body);
        counter++;
        return HttpResponse.json({ data: { id: String(counter), text: body.text } });
      }),
    );
    const auth = new XAuth();
    const draft: Draft = {
      channel: 'x',
      threadParts: ['part-0', 'part-1', 'part-2'],
    };
    const result = await postX(auth, draft);
    expect(tweetBodies).toEqual([
      { text: 'part-0' },
      { text: 'part-1', reply: { in_reply_to_tweet_id: '101' } },
      { text: 'part-2', reply: { in_reply_to_tweet_id: '102' } },
    ]);
    expect(result.postId).toBe('101'); // first tweet
    expect(result.url).toBe('https://x.com/brian/status/101');
  });

  it('attaches media only to the first tweet in a thread', async () => {
    const tweetBodies: { text: string; media?: { media_ids: string[] }; reply?: { in_reply_to_tweet_id: string } }[] = [];
    let counter = 200;
    server.use(
      mswHttp.post('https://api.x.com/2/media/upload', () =>
        HttpResponse.json({ data: { id: 'm-1', media_key: 'mk' } }),
      ),
      mswHttp.post('https://api.x.com/2/media/metadata', () =>
        HttpResponse.json({ data: { ok: true } }),
      ),
      mswHttp.post('https://api.x.com/2/tweets', async ({ request }) => {
        const body = (await request.json()) as (typeof tweetBodies)[0];
        tweetBodies.push(body);
        counter++;
        return HttpResponse.json({ data: { id: String(counter), text: body.text } });
      }),
    );
    const auth = new XAuth();
    const draft: Draft = {
      channel: 'x',
      threadParts: ['p0', 'p1'],
      media: [{ png: Buffer.from('a'), alt: 'a' }],
    };
    await postX(auth, draft);
    expect(tweetBodies[0].media).toEqual({ media_ids: ['m-1'] });
    expect(tweetBodies[1].media).toBeUndefined();
  });

  it('returns a dry-run result when DRY_RUN=1 and skips HTTP', async () => {
    server.use(
      mswHttp.post('https://api.x.com/2/tweets', () => {
        throw new Error('should not be called during dry-run');
      }),
    );
    process.env.DRY_RUN = '1';
    try {
      const auth = new XAuth();
      const draft: Draft = { channel: 'x', text: 'hello' };
      const result = await postX(auth, draft);
      expect(result.postId).toMatch(/^dry-/);
      expect(result.url).toMatch(/dry-run\.local/);
    } finally {
      delete process.env.DRY_RUN;
    }
  });

  const refreshHandler = () =>
    mswHttp.post('https://api.x.com/2/oauth2/token', () =>
      HttpResponse.json({
        access_token: 'a2',
        refresh_token: 'r2',
        token_type: 'bearer',
        expires_in: 7200,
      }),
    );

  it('retry after refresh sends the new access token (tweet create)', async () => {
    const seen: (string | null)[] = [];
    server.use(
      refreshHandler(),
      mswHttp.post('https://api.x.com/2/tweets', ({ request }) => {
        seen.push(request.headers.get('authorization'));
        if (seen.length === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ data: { id: '2001', text: 'hi' } });
      }),
    );
    const result = await postX(new XAuth(), { channel: 'x', text: 'hi' });
    expect(seen).toEqual(['Bearer access-1', 'Bearer a2']);
    expect(result.postId).toBe('2001');
  });

  it('retry after refresh sends the new access token (media upload)', async () => {
    const uploads: (string | null)[] = [];
    const later: (string | null)[] = [];
    server.use(
      refreshHandler(),
      mswHttp.post('https://api.x.com/2/media/upload', ({ request }) => {
        uploads.push(request.headers.get('authorization'));
        if (uploads.length === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ data: { id: 'm1', media_key: 'mk' } });
      }),
      mswHttp.post('https://api.x.com/2/media/metadata', ({ request }) => {
        later.push(request.headers.get('authorization'));
        return HttpResponse.json({ data: { ok: true } });
      }),
      mswHttp.post('https://api.x.com/2/tweets', ({ request }) => {
        later.push(request.headers.get('authorization'));
        return HttpResponse.json({ data: { id: '2002', text: 'hi' } });
      }),
    );
    await postX(new XAuth(), {
      channel: 'x',
      text: 'hi',
      media: [{ png: Buffer.from('a'), alt: 'alt' }],
    });
    expect(uploads).toEqual(['Bearer access-1', 'Bearer a2']);
    expect(later).toEqual(['Bearer a2', 'Bearer a2']);
  });

  it('tweet create is not retried on 503', async () => {
    let calls = 0;
    server.use(
      mswHttp.post('https://api.x.com/2/tweets', () => {
        calls++;
        return new HttpResponse('busy', { status: 503 });
      }),
    );
    await expect(postX(new XAuth(), { channel: 'x', text: 'hi' })).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(1);
  });

  it('tweet create is not retried on network error', async () => {
    let calls = 0;
    server.use(
      mswHttp.post('https://api.x.com/2/tweets', () => {
        calls++;
        return HttpResponse.error();
      }),
    );
    await expect(postX(new XAuth(), { channel: 'x', text: 'hi' })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('media upload is not retried on 503', async () => {
    let calls = 0;
    server.use(
      mswHttp.post('https://api.x.com/2/media/upload', () => {
        calls++;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    await expect(
      postX(new XAuth(), {
        channel: 'x',
        text: 'hi',
        media: [{ png: Buffer.from('a'), alt: 'alt' }],
      }),
    ).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(1);
  });
});
