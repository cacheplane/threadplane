import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { fetchDevToMetrics } from './metrics.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const apiKey = 'devto-key-123';

describe('fetchDevToMetrics', () => {
  it('maps Dev.to response fields to PostMetrics', async () => {
    server.use(
      mswHttp.get('https://dev.to/api/articles/42', () =>
        HttpResponse.json({
          id: 42,
          page_views_count: 1234,
          comments_count: 5,
          public_reactions_count: 17,
        }),
      ),
    );
    const metrics = await fetchDevToMetrics(apiKey, '42');
    expect(metrics.postId).toBe('42');
    expect(metrics.impressions).toBe(1234);
    expect(metrics.replies).toBe(5);
    expect(metrics.shares).toBe(17);
    expect(metrics.clicks).toBeUndefined();
    expect(metrics.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sends api-key + user-agent headers', async () => {
    let receivedHeaders: Headers | undefined;
    server.use(
      mswHttp.get('https://dev.to/api/articles/9', ({ request }) => {
        receivedHeaders = request.headers;
        return HttpResponse.json({
          id: 9,
          page_views_count: 0,
          comments_count: 0,
          public_reactions_count: 0,
        });
      }),
    );
    await fetchDevToMetrics(apiKey, '9');
    expect(receivedHeaders?.get('api-key')).toBe(apiKey);
    expect(receivedHeaders?.get('user-agent')).toBe('threadplane-marketing/1.0');
  });

  it('throws a clear error on 404', async () => {
    server.use(
      mswHttp.get('https://dev.to/api/articles/999', () =>
        new HttpResponse('{"error":"not found"}', { status: 404 }),
      ),
    );
    await expect(fetchDevToMetrics(apiKey, '999')).rejects.toThrow(
      /Dev\.to article 999 not found/,
    );
  });

  it('returns zeroes when fields are missing in response', async () => {
    server.use(
      mswHttp.get('https://dev.to/api/articles/1', () =>
        HttpResponse.json({ id: 1 }),
      ),
    );
    const metrics = await fetchDevToMetrics(apiKey, '1');
    expect(metrics.impressions).toBe(0);
    expect(metrics.replies).toBe(0);
    expect(metrics.shares).toBe(0);
  });
});
