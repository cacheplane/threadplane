import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { createAdapter, getAdapter } from './registry.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const hang = async () => {
  await new Promise((r) => setTimeout(r, 2_000));
  return HttpResponse.json({});
};

describe('registry', () => {
  it('createAdapter returns fresh instances and getAdapter stays a singleton', () => {
    const options = { devto: { credentials: { apiKey: 'k' } } };
    const a = createAdapter('devto', options);
    const b = createAdapter('devto', options);
    expect(a).not.toBe(b);
    expect(a.id).toBe('devto');

    const prev = process.env.DEVTO_API_KEY;
    process.env.DEVTO_API_KEY = 'env-key';
    try {
      expect(getAdapter('devto')).toBe(getAdapter('devto'));
    } finally {
      if (prev === undefined) delete process.env.DEVTO_API_KEY;
      else process.env.DEVTO_API_KEY = prev;
    }
  });

  it('createAdapter builds x and linkedin from injected credentials without env', () => {
    const x = createAdapter('x', {
      x: {
        credentials: {
          clientId: 'c',
          clientSecret: 's',
          accessToken: 'a',
          refreshToken: 'r',
          userHandle: 'h',
        },
      },
    });
    const li = createAdapter('linkedin', {
      linkedin: { credentials: { accessToken: 't', authorUrn: 'urn:li:person:a' } },
    });
    expect(x.id).toBe('x');
    expect(li.id).toBe('linkedin');
  });

  it('adapter requests abort with the step signal', async () => {
    server.use(
      mswHttp.post('https://api.x.com/2/tweets', hang),
      mswHttp.post('https://dev.to/api/articles', hang),
      mswHttp.post('https://api.linkedin.com/rest/posts', hang),
    );
    const controller = new AbortController();
    const options = {
      signal: controller.signal,
      x: {
        credentials: {
          clientId: 'c',
          clientSecret: 's',
          accessToken: 'a',
          refreshToken: 'r',
          userHandle: 'h',
        },
      },
      linkedin: { credentials: { accessToken: 't', authorUrn: 'urn:li:person:a' } },
      devto: { credentials: { apiKey: 'k' } },
    };
    const started = Date.now();
    const attempts = Promise.allSettled([
      createAdapter('x', options).post({ channel: 'x', text: 'hi' }),
      createAdapter('linkedin', options).post({ channel: 'linkedin', text: 'hi' }),
      createAdapter('devto', options).post({
        channel: 'devto',
        text: 'body',
        article: { title: 'T' },
      }),
    ]);
    setTimeout(() => controller.abort(new Error('step budget spent')), 30);
    const results = await attempts;
    expect(Date.now() - started).toBeLessThan(1_000);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/step budget spent/);
    }
  });
});
