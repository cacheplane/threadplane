import { describe, expect, it } from 'vitest';
import { nextConfig as config } from './next.config';

describe('website next.config rewrites', () => {
  it('exposes posthog-js rewrites under /ingest', async () => {
    expect(typeof config.rewrites).toBe('function');
    const rewrites = await config.rewrites!();
    const list = Array.isArray(rewrites) ? rewrites : rewrites.beforeFiles ?? [];
    const sources = list.map((r: { source: string }) => r.source);
    expect(sources).toContain('/ingest/static/:path*');
    expect(sources).toContain('/ingest/:path*');
    const staticRule = list.find((r: { source: string }) => r.source === '/ingest/static/:path*');
    expect(staticRule.destination).toBe('https://us-assets.i.posthog.com/static/:path*');
    const apiRule = list.find((r: { source: string }) => r.source === '/ingest/:path*');
    expect(apiRule.destination).toBe('https://us.i.posthog.com/:path*');
  });
});

/**
 * The dedicated telemetry docs library is retired in favour of one canonical
 * policy. Delivered links and search results outlive a deletion, so every
 * retired path — both the public routes and the markdown API that mirrors
 * them — has to land somewhere real rather than 404.
 */
describe('website next.config redirects', () => {
  const retired = [
    '/docs/telemetry',
    '/docs/telemetry/:path*',
    '/api/markdown/telemetry',
    '/api/markdown/telemetry/:path*',
  ];

  it('permanently redirects every retired telemetry route to the policy', async () => {
    expect(typeof config.redirects).toBe('function');
    const redirects = await config.redirects!();

    for (const source of retired) {
      const rule = redirects.find(
        (r: { source: string }) => r.source === source
      );
      expect(rule, `missing redirect for ${source}`).toBeTruthy();
      expect(rule.destination).toBe('/privacy');
      expect(rule.permanent).toBe(true);
    }
  });

  it('redirects the exact roots as well as their descendants', async () => {
    const sources = (await config.redirects!()).map(
      (r: { source: string }) => r.source
    );

    for (const base of ['/docs/telemetry', '/api/markdown/telemetry']) {
      expect(sources).toContain(base);
      expect(sources).toContain(`${base}/:path*`);
    }
  });
});

/**
 * `provideChat()` / `ChatConfig` / `CHAT_CONFIG` were removed from
 * `@threadplane/chat` — no shipped component ever injected the token, so the
 * three pages that documented them described a no-op. Their URLs were indexed
 * and linked, so each has to land on a page that still exists.
 */
describe('website next.config redirects for the removed chat configuration API', () => {
  const retired = [
    '/docs/chat/api/provide-chat',
    '/docs/chat/api/chat-config',
    '/docs/chat/guides/configuration',
  ];

  it('permanently redirects each retired page to chat installation', async () => {
    const redirects = await config.redirects!();

    for (const source of retired) {
      const rule = redirects.find(
        (r: { source: string }) => r.source === source
      );
      expect(rule, `missing redirect for ${source}`).toBeTruthy();
      expect(rule.destination).toBe('/docs/chat/getting-started/installation');
      expect(rule.permanent).toBe(true);
    }
  });

  it('redirects the markdown mirror of each retired page', async () => {
    const redirects = await config.redirects!();

    for (const source of retired) {
      const mirror = source.replace('/docs/', '/api/markdown/');
      const rule = redirects.find((r: { source: string }) => r.source === mirror);
      expect(rule, `missing redirect for ${mirror}`).toBeTruthy();
      expect(rule.destination).toBe(
        '/api/markdown/chat/getting-started/installation'
      );
      expect(rule.permanent).toBe(true);
    }
  });
});

/**
 * Lifecycle mail links to `/call` rather than the Google Calendar host so every
 * URL in the message matches the sending domain. The redirect must stay
 * temporary so the booking page can move without stale browser caches.
 */
describe('website next.config founder booking redirect', () => {
  it('temporarily redirects /call to the Google Calendar booking page', async () => {
    const redirects = await config.redirects!();
    const rule = redirects.find((r: { source: string }) => r.source === '/call');

    expect(rule).toBeTruthy();
    expect(rule.destination).toBe(
      'https://calendar.app.google/nK961tWHZd21izKR6'
    );
    expect(rule.permanent).toBe(false);
  });
});


describe('legacy API reference migration', () => {
  const destinations = {
    'render/render-spec-component': '/docs/render/guides/element-rendering',
    'render/provide-render': '/docs/render/guides/computed-functions',
    'render/define-angular-registry': '/docs/api/render/defineAngularRegistry',
    'render/signal-state-store': '/docs/api/render/signalStateStore',
    'render/views': '/docs/api/render/views',
    'langgraph/inject-agent': '/docs/api/langgraph/injectAgent',
    'langgraph/provide-agent': '/docs/api/langgraph/provideAgent',
    'langgraph/fetch-stream-transport': '/docs/api/langgraph/FetchStreamTransport',
    'langgraph/mock-stream-transport': '/docs/api/langgraph/MockAgentTransport',
    'langgraph/langgraph-threads-adapter': '/docs/api/langgraph/LangGraphThreadsAdapter',
    'ag-ui/inject-agent': '/docs/api/ag-ui/injectAgent',
    'ag-ui/provide-agent': '/docs/api/ag-ui/provideAgent',
    'ag-ui/to-agent': '/docs/api/ag-ui/toAgent',
    'ag-ui/fake-agent': '/docs/api/ag-ui/FakeAgent',
    'chat/content-classifier': '/docs/api/chat/createContentClassifier',
    'chat/parse-tree-store': '/docs/api/chat/createParseTreeStore',
    'chat/mock-agent': '/docs/api/chat/mockAgent',
    'middleware/client-tool-helpers': '/docs/api/middleware/langgraph',
  };

  it('permanently redirects the complete legacy inventory and its Markdown mirrors', async () => {
    const redirects = await config.redirects!();
    expect(Object.keys(destinations)).toHaveLength(18);
    for (const [identity, destination] of Object.entries(destinations)) {
      const [library, slug] = identity.split('/');
      for (const prefix of ['/docs/', '/api/markdown/']) {
        const source = `${prefix}${library}/api/${slug}`;
        expect(redirects.find(rule => rule.source === source), source).toMatchObject({
          source,
          destination: destination.replace('/docs/', prefix),
          permanent: true,
        });
      }
    }
  });
});
