import { describe, expect, it, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { postDevTo } from './post.ts';
import type { Draft } from '../types.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const apiKey = 'devto-key-123';

function baseDraft(): Draft {
  return {
    channel: 'devto',
    text: '# Hello\n\nBody',
    article: {
      title: 'Hello',
      tags: ['angular', 'tutorial'],
      canonicalUrl: 'https://threadplane.ai/blog/hello',
      description: 'A hello article.',
    },
  };
}

describe('postDevTo', () => {
  it('POSTs the full article shape and returns a PostResult', async () => {
    let receivedBody: unknown;
    let receivedHeaders: Headers | undefined;
    server.use(
      mswHttp.post('https://dev.to/api/articles', async ({ request }) => {
        receivedBody = await request.json();
        receivedHeaders = request.headers;
        return HttpResponse.json({
          id: 42,
          url: 'https://dev.to/brian/hello-1abc',
          published_at: '2026-05-17T12:00:00Z',
        });
      }),
    );

    const result = await postDevTo(apiKey, baseDraft());

    expect(receivedHeaders?.get('api-key')).toBe(apiKey);
    expect(receivedHeaders?.get('content-type')).toMatch(/application\/json/);
    expect(receivedHeaders?.get('user-agent')).toBe('threadplane-marketing/1.0');
    expect(receivedBody).toEqual({
      article: {
        title: 'Hello',
        body_markdown: '# Hello\n\nBody',
        published: true,
        tags: ['angular', 'tutorial'],
        canonical_url: 'https://threadplane.ai/blog/hello',
        description: 'A hello article.',
      },
    });
    expect(result).toEqual({
      channel: 'devto',
      postId: '42',
      url: 'https://dev.to/brian/hello-1abc',
      postedAt: '2026-05-17T12:00:00Z',
    });
  });

  it('omits optional fields when not set', async () => {
    let receivedBody: { article: Record<string, unknown> } | undefined;
    server.use(
      mswHttp.post('https://dev.to/api/articles', async ({ request }) => {
        receivedBody = (await request.json()) as typeof receivedBody;
        return HttpResponse.json({
          id: 7,
          url: 'https://dev.to/brian/min-7',
          published_at: '2026-05-17T12:00:00Z',
        });
      }),
    );

    const draft: Draft = {
      channel: 'devto',
      text: 'Just body.',
      article: { title: 'Minimal' },
    };
    await postDevTo(apiKey, draft);

    expect(receivedBody?.article).toEqual({
      title: 'Minimal',
      body_markdown: 'Just body.',
      published: true,
    });
    expect(Object.keys(receivedBody!.article)).not.toContain('tags');
    expect(Object.keys(receivedBody!.article)).not.toContain('canonical_url');
    expect(Object.keys(receivedBody!.article)).not.toContain('description');
  });

  it('falls back to current time when published_at is missing in response', async () => {
    server.use(
      mswHttp.post('https://dev.to/api/articles', () =>
        HttpResponse.json({ id: 1, url: 'https://dev.to/brian/x' }),
      ),
    );
    const result = await postDevTo(apiKey, baseDraft());
    expect(result.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws with regenerate hint on 401', async () => {
    server.use(
      mswHttp.post('https://dev.to/api/articles', () =>
        new HttpResponse('{"error":"unauthorized"}', { status: 401 }),
      ),
    );
    await expect(postDevTo(apiKey, baseDraft())).rejects.toThrow(
      /Dev\.to API key rejected.*re-generate/i,
    );
  });

  it('throws with response body on 422 validation error', async () => {
    server.use(
      mswHttp.post('https://dev.to/api/articles', () =>
        new HttpResponse(
          '{"error":"Tag is not allowed: bad_tag","status":422}',
          { status: 422 },
        ),
      ),
    );
    await expect(postDevTo(apiKey, baseDraft())).rejects.toThrow(/bad_tag/);
  });

  it('writes a dry-run file and skips HTTP when DRY_RUN=1', async () => {
    server.use(
      mswHttp.post('https://dev.to/api/articles', () => {
        throw new Error('should not be called during dry-run');
      }),
    );
    process.env.DRY_RUN = '1';
    try {
      const result = await postDevTo(apiKey, baseDraft());
      expect(result.postId).toMatch(/^dry-/);
      expect(result.channel).toBe('devto');
      expect(result.url).toMatch(/dry-run\.local/);
    } finally {
      delete process.env.DRY_RUN;
    }
  });
});
