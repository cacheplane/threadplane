import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCapturePayload, classifyRequest, config, sendToPostHog } from './middleware';
import { createEmissionBudget, EMISSION_BUCKET_CAPACITY } from './lib/analytics/ai-traffic';

const MATCHERS = config.matcher.map((m) => new RegExp(`^${m}$`));
const matches = (path: string) => MATCHERS.some((re) => re.test(path));

const budget = () => createEmissionBudget(0);

describe('middleware matcher', () => {
  it.each([
    '/',
    '/blog/x',
    '/docs/angular/chat/overview',
    '/about',
    // Files written for AI consumers / strongest crawler-intent signals.
    '/llms.txt',
    '/llms-full.txt',
    '/sitemap.xml',
    '/robots.txt',
    // Anchored exclusion: a page merely *named* after OG images is still observed.
    '/my-opengraph-image-guide',
    '/opengraph-image-not-really',
    '/blog/twitter-image-tips',
  ])('matches %s', (p) => {
    expect(matches(p)).toBe(true);
  });

  it.each([
    '/api/leads',
    '/_next/static/chunk.js',
    '/_next/image',
    '/ingest/e',
    '/ingest/static/array.js',
    '/favicon.ico',
    '/opengraph-image',
    '/blog/my-post/opengraph-image',
    '/twitter-image',
    '/whitepapers/overview.pdf',
    '/some/script.js',
  ])('excludes %s', (p) => {
    expect(matches(p)).toBe(false);
  });
});

describe('classifyRequest', () => {
  const base = { path: '/blog/a', now: 0 };

  it('captures an AI crawler visit with the path but no query string', () => {
    expect(
      classifyRequest({
        ...base,
        userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
        referrer: null,
        seen: new Set(),
        budget: budget(),
      }),
    ).toEqual({
      event: 'marketing:ai_crawler_visit',
      distinctId: 'ai_crawler:gptbot',
      properties: {
        ai_crawler: 'gptbot',
        source_page: '/blog/a',
        user_agent: 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      },
    });
  });

  it('captures an AI referral visit without the user agent or referrer url', () => {
    expect(
      classifyRequest({
        ...base,
        userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36',
        referrer: 'https://www.perplexity.ai/search?q=angular+agent',
        seen: new Set(),
        budget: budget(),
      }),
    ).toEqual({
      event: 'marketing:ai_referral_visit',
      distinctId: 'ai_referral:perplexity',
      properties: { ai_source: 'perplexity', source_page: '/blog/a' },
    });
  });

  it('prefers the crawler classification when both match', () => {
    const capture = classifyRequest({
      ...base,
      userAgent: 'ClaudeBot/1.0',
      referrer: 'https://claude.ai/chat/1',
      seen: new Set(),
      budget: budget(),
    });
    expect(capture?.event).toBe('marketing:ai_crawler_visit');
  });

  it('returns null for ordinary human traffic', () => {
    expect(
      classifyRequest({
        ...base,
        userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36',
        referrer: 'https://www.google.com/search?q=x',
        seen: new Set(),
        budget: budget(),
      }),
    ).toBeNull();
  });

  it('returns null for a repeat crawler hit on the same path in the same hour', () => {
    const seen = new Set<string>();
    const b = budget();
    expect(classifyRequest({ ...base, userAgent: 'GPTBot/1.2', referrer: null, seen, budget: b })).not.toBeNull();
    expect(classifyRequest({ ...base, userAgent: 'GPTBot/1.2', referrer: null, seen, budget: b })).toBeNull();
  });

  it('does not spend a token on a deduplicated crawler hit', () => {
    const seen = new Set<string>();
    const b = budget();
    classifyRequest({ ...base, userAgent: 'GPTBot/1.2', referrer: null, seen, budget: b });
    const afterFirst = b.tokens;
    classifyRequest({ ...base, userAgent: 'GPTBot/1.2', referrer: null, seen, budget: b });
    expect(b.tokens).toBe(afterFirst);
  });

  it('does not spend a token on ordinary human traffic', () => {
    const b = budget();
    classifyRequest({
      ...base,
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131',
      referrer: null,
      seen: new Set(),
      budget: b,
    });
    expect(b.tokens).toBe(EMISSION_BUCKET_CAPACITY);
  });

  it('truncates an abusive user-agent string', () => {
    const capture = classifyRequest({
      ...base,
      userAgent: `GPTBot/1.2 ${'x'.repeat(5000)}`,
      referrer: null,
      seen: new Set(),
      budget: budget(),
    });
    expect((capture?.properties.user_agent as string).length).toBe(200);
  });
});

describe('emission ceiling (abuse bound)', () => {
  it('caps a spoofed-referrer flood at the bucket capacity', () => {
    const b = budget();
    let emitted = 0;
    for (let i = 0; i < 5000; i++) {
      const capture = classifyRequest({
        path: `/p/${i}`,
        now: 0,
        userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131',
        referrer: `https://chatgpt.com/c/${i}`,
        seen: new Set(),
        budget: b,
      });
      if (capture) emitted++;
    }
    expect(emitted).toBe(EMISSION_BUCKET_CAPACITY);
  });

  it('caps a crawler-UA flood across varying paths, which dedup alone cannot', () => {
    const seen = new Set<string>();
    const b = budget();
    let emitted = 0;
    for (let i = 0; i < 5000; i++) {
      const capture = classifyRequest({
        path: `/blog/nonexistent-${i}`,
        now: 0,
        userAgent: 'GPTBot/1.2',
        referrer: null,
        seen,
        budget: b,
      });
      if (capture) emitted++;
    }
    expect(emitted).toBe(EMISSION_BUCKET_CAPACITY);
  });

  it('refills over time so a throttled instance recovers', () => {
    const b = budget();
    for (let i = 0; i < 5000; i++) {
      classifyRequest({
        path: `/p/${i}`,
        now: 0,
        userAgent: 'Mozilla/5.0 Chrome/131',
        referrer: 'https://claude.ai/chat/1',
        seen: new Set(),
        budget: b,
      });
    }
    // Exhausted at t=0; one hour later the bucket is full again.
    const after = classifyRequest({
      path: '/p/x',
      now: 60 * 60 * 1000,
      userAgent: 'Mozilla/5.0 Chrome/131',
      referrer: 'https://claude.ai/chat/1',
      seen: new Set(),
      budget: b,
    });
    expect(after).not.toBeNull();
  });
});

describe('sendToPostHog payload contract', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEXT_PUBLIC_POSTHOG_TOKEN = 'phc_test';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://us.i.posthog.com';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it('posts a crawler visit to the ingest endpoint with the anonymous property set', async () => {
    await sendToPostHog({
      event: 'marketing:ai_crawler_visit',
      distinctId: 'ai_crawler:gptbot',
      properties: { ai_crawler: 'gptbot', source_page: '/blog/a', user_agent: 'GPTBot/1.2' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // `keepalive` is a browser-unload primitive; waitUntil is what holds the
    // invocation open here. Its presence would imply a mechanism that is not
    // operating.
    expect(init.keepalive).toBeUndefined();

    const body = lastBody();
    expect(body.api_key).toBe('phc_test');
    expect(body.event).toBe('marketing:ai_crawler_visit');
    expect(body.distinct_id).toBe('ai_crawler:gptbot');
    expect(body.properties.$process_person_profile).toBe(false);
    expect(body.properties.$ip).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(body.properties, '$ip')).toBe(true);
    expect(body.properties.ai_crawler).toBe('gptbot');
    expect(body.properties.source_page).toBe('/blog/a');
  });

  it('posts a referral visit carrying neither the user agent nor the referrer url', async () => {
    await sendToPostHog({
      event: 'marketing:ai_referral_visit',
      distinctId: 'ai_referral:chatgpt',
      properties: { ai_source: 'chatgpt', source_page: '/pricing' },
    });

    const body = lastBody();
    expect(body.properties.$process_person_profile).toBe(false);
    expect(body.properties.$ip).toBeNull();
    expect(body.properties.user_agent).toBeUndefined();
    expect(Object.keys(body.properties).sort()).toEqual([
      '$ip',
      '$lib',
      '$process_person_profile',
      'ai_source',
      'source_page',
    ]);
  });

  it('never lets a query string or a referrer url reach the wire', async () => {
    await sendToPostHog({
      event: 'marketing:ai_referral_visit',
      distinctId: 'ai_referral:perplexity',
      // `classifyRequest` only ever supplies a bare pathname; assert the
      // serializer does not reintroduce anything either.
      properties: { ai_source: 'perplexity', source_page: '/pricing' },
    });

    const raw = fetchMock.mock.calls[0][1].body as string;
    expect(raw).not.toContain('?');
    expect(raw).not.toContain('perplexity.ai');
    expect(raw).not.toContain('http://');
    expect(raw.match(/https:/g)).toBeNull();
  });

  it('does not fire at all when no PostHog token is configured', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
    await sendToPostHog({
      event: 'marketing:ai_crawler_visit',
      distinctId: 'ai_crawler:gptbot',
      properties: { ai_crawler: 'gptbot', source_page: '/' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a failing capture so it can never surface to a visitor', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(
      sendToPostHog({
        event: 'marketing:ai_crawler_visit',
        distinctId: 'ai_crawler:gptbot',
        properties: { ai_crawler: 'gptbot', source_page: '/' },
      }),
    ).resolves.toBeUndefined();
  });

  it('defaults to the PostHog cloud host when none is configured', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    await sendToPostHog({
      event: 'marketing:ai_crawler_visit',
      distinctId: 'ai_crawler:gptbot',
      properties: { ai_crawler: 'gptbot', source_page: '/' },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://us.i.posthog.com/i/v0/e/');
  });
});

describe('buildCapturePayload', () => {
  it('cannot be overridden by a caller-supplied property', () => {
    const payload = buildCapturePayload(
      {
        event: 'marketing:ai_crawler_visit',
        distinctId: 'ai_crawler:gptbot',
        // A hostile or careless caller must not be able to re-enable person
        // processing or GeoIP.
        properties: { $process_person_profile: true, $ip: '1.2.3.4', source_page: '/' },
      },
      'phc_test',
      '2026-01-01T00:00:00.000Z',
    );
    expect(payload.properties.$process_person_profile).toBe(false);
    expect(payload.properties.$ip).toBeNull();
  });
});
