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
});
