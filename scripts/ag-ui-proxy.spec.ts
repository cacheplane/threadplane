// scripts/ag-ui-proxy.spec.ts
//
// Behavior contract for the AG-UI examples proxy, added with the Mastra
// topic→upstream map. The load-bearing assertions: every EXISTING /ag-ui
// topic still routes to the default Railway FastAPI upstream with identical
// origin/token/streaming behavior, while the `mastra` topic (served from the
// /runtimes path) routes to AG_UI_MASTRA_URL.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The proxy file assigns `module.exports = handler` (Vercel Node function
// convention); esModuleInterop surfaces that as the default export.
import handler from './ag-ui-proxy';

type MockRes = {
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  _status: number;
};

function makeRes(): MockRes {
  const res: Partial<MockRes> = { _status: 0 };
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number) => {
    res._status = code;
    return res as MockRes;
  });
  res.json = vi.fn();
  res.write = vi.fn();
  res.end = vi.fn();
  return res as MockRes;
}

function makeReq(url: string, origin = 'https://examples.threadplane.ai') {
  return {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: { threadId: 't1' },
    url,
  };
}

const RAILWAY_DEFAULT = 'https://ag-ui-dev-production.up.railway.app';

describe('AG-UI proxy', () => {
  beforeEach(() => {
    process.env['AG_UI_INTERNAL_TOKEN'] = 'test-token';
    delete process.env['AG_UI_RAILWAY_URL'];
    delete process.env['AG_UI_MASTRA_URL'];
    delete process.env['AG_UI_MAF_URL'];
    delete process.env['UPSTASH_REDIS_REST_URL'];
    delete process.env['UPSTASH_REDIS_REST_TOKEN'];
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockUpstream() {
    return vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('data: {"type":"RUN_STARTED"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
  }

  it('routes every existing /ag-ui topic to the default Railway upstream with the internal token (unchanged behavior)', async () => {
    const existingTopics = [
      'interrupts',
      'streaming',
      'tool-views',
      'json-render',
      'client-tools',
      'a2ui',
      'subagents',
      'aws-strands',
    ];
    for (const topic of existingTopics) {
      const fetchMock = mockUpstream();
      const res = makeRes();
      await handler(makeReq(`/ag-ui/${topic}/agent`), res as never);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${RAILWAY_DEFAULT}/agent/${topic}`);
      expect((init.headers as Record<string, string>)['x-internal-token']).toBe('test-token');
      expect(res._status).toBe(200);
      vi.restoreAllMocks();
    }
  });

  it('routes /runtimes/<python-lane topic>/agent to the default Railway upstream', async () => {
    const fetchMock = mockUpstream();
    const res = makeRes();
    await handler(makeReq('/runtimes/aws-strands/agent'), res as never);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${RAILWAY_DEFAULT}/agent/aws-strands`);
  });

  it('routes the microsoft-agent-framework topic to AG_UI_MAF_URL', async () => {
    process.env['AG_UI_MAF_URL'] = 'https://maf.test';
    const fetchMock = mockUpstream();
    const res = makeRes();
    await handler(makeReq('/runtimes/microsoft-agent-framework/agent'), res as never);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://maf.test/agent/microsoft-agent-framework');
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('test-token');
  });

  it('returns a clear 500 for the MAF topic when AG_UI_MAF_URL is unset', async () => {
    const fetchMock = mockUpstream();
    const res = makeRes();
    await handler(makeReq('/runtimes/microsoft-agent-framework/agent'), res as never);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res._status).toBe(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'misconfigured',
      detail: 'no upstream configured for topic microsoft-agent-framework',
    });
  });

  it('routes the mastra topic to AG_UI_MASTRA_URL', async () => {
    process.env['AG_UI_MASTRA_URL'] = 'https://ag-ui-mastra.example.up.railway.app';
    const fetchMock = mockUpstream();
    const res = makeRes();
    await handler(makeReq('/runtimes/mastra/agent'), res as never);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ag-ui-mastra.example.up.railway.app/agent/mastra');
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('test-token');
  });

  it('returns a clear 500 for the mastra topic when AG_UI_MASTRA_URL is unset', async () => {
    const fetchMock = mockUpstream();
    const res = makeRes();
    await handler(makeReq('/runtimes/mastra/agent'), res as never);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res._status).toBe(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'misconfigured',
      detail: 'no upstream configured for topic mastra',
    });
  });

  it('still rejects disallowed origins before any upstream call', async () => {
    const fetchMock = mockUpstream();
    const res = makeRes();
    await handler(makeReq('/ag-ui/streaming/agent', 'https://evil.example'), res as never);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'origin_not_allowed' });
  });

  it('still 404s paths outside the two proxied shapes', async () => {
    const fetchMock = mockUpstream();
    for (const path of ['/ag-ui/streaming', '/chat/messages/agent', '/runtimes/mastra', '/mastra/agent']) {
      const res = makeRes();
      await handler(makeReq(path), res as never);
      expect(res._status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
