import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { postLinkedIn } from './post.ts';
import { LinkedInAuth } from './auth.ts';
import { LINKEDIN_VERSION } from './api.ts';
import type { Draft } from '../types.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const AUTHOR = 'urn:li:person:abc123';
const POST_URN = 'urn:li:share:7000000000000000001';
const UPLOAD_URL = 'https://www.linkedin.com/dms-uploads/img-1/uploaded-image/0';

let origEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  origEnv = { ...process.env };
  Object.assign(process.env, {
    LINKEDIN_ACCESS_TOKEN: 'li-access-1',
    LINKEDIN_AUTHOR_URN: AUTHOR,
    LINKEDIN_TOKEN_EXPIRES_AT: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  delete process.env.DRY_RUN;
});
afterEach(() => {
  process.env = origEnv;
});

function postsHandler(onBody: (body: Record<string, unknown>, req: Request) => void) {
  return mswHttp.post('https://api.linkedin.com/rest/posts', async ({ request }) => {
    onBody((await request.json()) as Record<string, unknown>, request);
    return new HttpResponse(null, { status: 201, headers: { 'x-restli-id': POST_URN } });
  });
}

describe('postLinkedIn', () => {
  it('creates a text post with versioned headers and escaped commentary', async () => {
    let body: Record<string, unknown> | undefined;
    let headers: Headers | undefined;
    server.use(
      postsHandler((b, req) => {
        body = b;
        headers = req.headers;
      }),
    );

    const draft: Draft = { channel: 'linkedin', text: 'Who owns it (you)? #Angular' };
    const result = await postLinkedIn(new LinkedInAuth(), draft);

    expect(headers?.get('authorization')).toBe('Bearer li-access-1');
    expect(headers?.get('linkedin-version')).toBe(LINKEDIN_VERSION);
    expect(headers?.get('x-restli-protocol-version')).toBe('2.0.0');
    expect(body).toEqual({
      author: AUTHOR,
      commentary: 'Who owns it \\(you\\)? #Angular',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });
    expect(result).toMatchObject({
      channel: 'linkedin',
      postId: POST_URN,
      url: `https://www.linkedin.com/feed/update/${POST_URN}/`,
    });
    expect(result.warnings).toBeUndefined();
  });

  it('uploads the image first and attaches it with alt text', async () => {
    const calls: string[] = [];
    let initBody: unknown;
    let uploaded: ArrayBuffer | undefined;
    let postBody: Record<string, unknown> | undefined;
    server.use(
      mswHttp.post('https://api.linkedin.com/rest/images', async ({ request }) => {
        calls.push(`init ${new URL(request.url).search}`);
        initBody = await request.json();
        return HttpResponse.json({
          value: { uploadUrl: UPLOAD_URL, image: 'urn:li:image:img-1', uploadUrlExpiresAt: 0 },
        });
      }),
      mswHttp.put(UPLOAD_URL, async ({ request }) => {
        calls.push('upload');
        uploaded = await request.arrayBuffer();
        return new HttpResponse(null, { status: 201 });
      }),
      postsHandler((b) => {
        calls.push('post');
        postBody = b;
      }),
    );

    await postLinkedIn(new LinkedInAuth(), {
      channel: 'linkedin',
      text: 'hi',
      media: [{ png: Buffer.from('png-bytes'), alt: 'the card' }],
    });

    expect(calls).toEqual(['init ?action=initializeUpload', 'upload', 'post']);
    expect(initBody).toEqual({ initializeUploadRequest: { owner: AUTHOR } });
    expect(Buffer.from(uploaded!).toString()).toBe('png-bytes');
    expect(postBody?.content).toEqual({ media: { id: 'urn:li:image:img-1', altText: 'the card' } });
  });

  it('posts firstComment on the new post as the author, unescaped', async () => {
    let commentUrl: string | undefined;
    let commentBody: unknown;
    server.use(
      postsHandler(() => undefined),
      mswHttp.post('https://api.linkedin.com/rest/socialActions/:urn/comments', async ({ request }) => {
        commentUrl = request.url;
        commentBody = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const result = await postLinkedIn(new LinkedInAuth(), {
      channel: 'linkedin',
      text: 'hi',
      firstComment: 'Read it: https://threadplane.ai/?utm_source=linkedin',
    });

    expect(commentUrl).toBe(
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(POST_URN)}/comments`,
    );
    expect(commentBody).toEqual({
      actor: AUTHOR,
      object: POST_URN,
      message: { text: 'Read it: https://threadplane.ai/?utm_source=linkedin' },
    });
    expect(result.warnings).toBeUndefined();
  });

  it('returns the live post with a warning when the comment fails', async () => {
    server.use(
      postsHandler(() => undefined),
      mswHttp.post('https://api.linkedin.com/rest/socialActions/:urn/comments', () =>
        HttpResponse.json({ message: 'ACCESS_DENIED' }, { status: 403 }),
      ),
    );

    const result = await postLinkedIn(new LinkedInAuth(), {
      channel: 'linkedin',
      text: 'hi',
      firstComment: 'link',
    });

    expect(result.postId).toBe(POST_URN);
    expect(result.warnings?.[0]).toMatch(/first comment failed.*403/);
  });

  it('does not retry a 5xx create, so a post is never doubled', async () => {
    let attempts = 0;
    server.use(
      mswHttp.post('https://api.linkedin.com/rest/posts', () => {
        attempts++;
        return new HttpResponse('boom', { status: 503 });
      }),
    );

    await expect(
      postLinkedIn(new LinkedInAuth(), { channel: 'linkedin', text: 'hi' }),
    ).rejects.toThrow(/HTTP 503/);
    expect(attempts).toBe(1);
  });

  it('turns a 401 into the bootstrapper hint', async () => {
    server.use(
      mswHttp.post('https://api.linkedin.com/rest/posts', () =>
        HttpResponse.json({ code: 'EXPIRED_ACCESS_TOKEN' }, { status: 401 }),
      ),
    );

    await expect(
      postLinkedIn(new LinkedInAuth(), { channel: 'linkedin', text: 'hi' }),
    ).rejects.toThrow(/marketing:channels:linkedin:auth/);
  });

  it('refuses to call the API with an expired token', async () => {
    process.env.LINKEDIN_TOKEN_EXPIRES_AT = '2020-01-01T00:00:00.000Z';
    await expect(
      postLinkedIn(new LinkedInAuth(), { channel: 'linkedin', text: 'hi' }),
    ).rejects.toThrow(/expired/);
  });

  it('fails loudly when the create response has no post id', async () => {
    server.use(
      mswHttp.post('https://api.linkedin.com/rest/posts', () => new HttpResponse(null, { status: 201 })),
    );
    await expect(
      postLinkedIn(new LinkedInAuth(), { channel: 'linkedin', text: 'hi' }),
    ).rejects.toThrow(/x-restli-id/);
  });

  it('writes a dry-run result without calling LinkedIn, even with an expired token', async () => {
    process.env.DRY_RUN = '1';
    process.env.LINKEDIN_TOKEN_EXPIRES_AT = '2020-01-01T00:00:00.000Z';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-dry-run-'));
    process.env.MARKETING_DRY_RUN_DIR = dir;
    try {
      const result = await postLinkedIn(new LinkedInAuth(), { channel: 'linkedin', text: 'hi' });
      expect(result.url).toMatch(/^https:\/\/dry-run\.local\/linkedin\//);
      expect(fs.readdirSync(dir)).toEqual([`${result.postId}.json`]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
