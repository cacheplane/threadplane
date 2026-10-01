// scripts/ag-ui-proxy.ts
/**
 * Vercel Node serverless function that proxies AG-UI requests from
 * examples.threadplane.ai to the Railway-hosted FastAPI runtime
 * (deployments/ag-ui-dev/). Provides defense-in-depth around the
 * OpenAI-backed runtime:
 *
 *   1. Origin allowlist — only known threadplane hosts can reach the proxy.
 *   2. Per-IP token-bucket rate limit via Upstash.
 *   3. Server-side injection of X-Internal-Token, verified by the FastAPI
 *      middleware before any /agent/<topic> handler runs.
 *
 * Bundled by scripts/assemble-examples.ts into
 * `.vercel/output/functions/ag-ui-proxy/[[...path]].func/index.js`
 * (NOT under functions/api/ — the route table's catch-all `^/api/(.*)` for
 * the langgraph proxy would otherwise re-match the rewrite via check:true
 * and shadow this function). Invoked by the routes
 *   { src: '^/ag-ui/([^/]+)/agent(/.*)?$', dest: '/ag-ui-proxy/[[...path]]' }
 *   { src: '^/runtimes/([^/]+)/agent(/.*)?$', dest: '/ag-ui-proxy/[[...path]]' }
 * The dest names the catch-all function, which Vercel invokes while
 * PRESERVING the original request URL in req.url — so this function parses
 * the public `/ag-ui/<topic>/agent` (or `/runtimes/<topic>/agent`) path,
 * not the `/ag-ui-proxy/...` dest.
 *
 * AG-UI uses streaming responses (Server-Sent Events / chunked), so the
 * upstream body is piped chunk-by-chunk rather than buffered.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const RAILWAY_BASE_URL =
  process.env['AG_UI_RAILWAY_URL'] ?? 'https://ag-ui-dev-production.up.railway.app';

/**
 * Topic → upstream override map. Topics not listed here keep routing to the
 * default FastAPI runtime (RAILWAY_BASE_URL) — the Python hosting lane. The
 * `mastra` topic is served by the separate Node service
 * (deployments/ag-ui-mastra, Railway service `ag-ui-mastra`); its base URL
 * comes from the AG_UI_MASTRA_URL env var on the Vercel examples project.
 * The `microsoft-agent-framework` topic is served by the separate Python
 * service deployments/ag-ui-maf (Railway service `ag-ui-maf`); its base URL
 * comes from AG_UI_MAF_URL.
 * Both upstreams verify the same X-Internal-Token header contract.
 *
 * Values are read lazily per request so a missing env var yields a clear
 * 500 for that topic only, never a module-load crash.
 */
function upstreamBaseFor(topic: string): string | null {
  if (topic === 'mastra') {
    return process.env['AG_UI_MASTRA_URL'] ?? null;
  }
  if (topic === 'microsoft-agent-framework') {
    // Hosted apart from ag-ui-dev: its bridge caps ag-ui-protocol below 1.0.
    return process.env['AG_UI_MAF_URL'] ?? null;
  }
  return RAILWAY_BASE_URL;
}

const ALLOWED_ORIGINS = new Set<string>([
  'https://examples.threadplane.ai',
  'http://localhost:4320',
  'http://localhost:4321',
]);

// Lazy-init so missing env vars don't crash at module load (the misconfig
// path returns 500 with a clear error instead of a cryptic import error).
let ratelimit: Ratelimit | null = null;
function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit;
  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.tokenBucket(10, '60 s', 10),
    analytics: false,
    prefix: 'ag-ui-dev',
  });
  return ratelimit;
}

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  url?: string;
}

interface VercelResponse {
  setHeader(k: string, v: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): void;
  write(chunk: Buffer | string): void;
  end(): void;
}

function extractIp(headers: VercelRequest['headers']): string {
  const fwd = headers['x-forwarded-for'];
  const fwdStr = Array.isArray(fwd) ? fwd[0] : fwd;
  if (fwdStr) {
    const first = fwdStr.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers['x-real-ip'];
  const realStr = Array.isArray(real) ? real[0] : real;
  if (realStr) return realStr.trim();
  return `unknown:${Math.random().toString(36).slice(2, 10)}`;
}

function getOrigin(headers: VercelRequest['headers']): string | undefined {
  const o = headers['origin'];
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return o[0];
  return undefined;
}

/**
 * Parse the original public URL `/ag-ui/<topic>/agent[/<rest>]` into
 * { topic, rest } so the upstream URL can be built as
 * `<railway>/agent/<topic><rest>`.
 *
 * The route dest `/ag-ui-proxy/[[...path]]` invokes this function while
 * Vercel PRESERVES the original request URL in req.url (same mechanism the
 * langgraph proxy relies on), so what we parse here is the public path the
 * browser requested, not the rewritten `/ag-ui-proxy/...` path.
 */
function parseProxyPath(url: string): { topic: string; rest: string } | null {
  const u = new URL(url, 'http://placeholder');
  const segments = u.pathname.split('/').filter(Boolean);
  // Expected: ['ag-ui' | 'runtimes', '<topic>', 'agent', ...rest]. The
  // 'runtimes' product (cockpit/runtimes/<topic>/) is AG-UI-served exactly
  // like the AG-UI product; the upstream URL is /agent/<topic> either way.
  if (
    (segments[0] !== 'ag-ui' && segments[0] !== 'runtimes') ||
    !segments[1] ||
    segments[2] !== 'agent'
  ) {
    return null;
  }
  const topic = segments[1];
  const rest = segments.slice(3).join('/');
  const restPath = rest ? `/${rest}` : '';
  return { topic, rest: restPath };
}

module.exports = async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');

  const origin = getOrigin(req.headers);
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({ error: 'origin_not_allowed' });
      return;
    }
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const internalToken = process.env['AG_UI_INTERNAL_TOKEN'];
  if (!internalToken) {
    res.status(500).json({ error: 'misconfigured', detail: 'AG_UI_INTERNAL_TOKEN unset' });
    return;
  }

  const parsed = parseProxyPath(req.url ?? '');
  if (!parsed) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const rl = getRatelimit();
  if (rl) {
    const ip = extractIp(req.headers);
    const verdict = await rl.limit(`${parsed.topic}:${ip}`);
    if (!verdict.success) {
      res.setHeader('retry-after', '60');
      res.status(429).json({ error: 'rate_limit_exceeded' });
      return;
    }
  }
  // If Upstash creds are missing the proxy still works — we deliberately
  // fail-open on rate-limit so a misconfigured Vercel project doesn't
  // brick the runtime. Origin allowlist + internal token still apply.

  // Preserve any query string from the original request on the upstream call.
  const query = (() => {
    const qIndex = (req.url ?? '').indexOf('?');
    return qIndex >= 0 ? (req.url as string).slice(qIndex) : '';
  })();
  const upstreamBase = upstreamBaseFor(parsed.topic);
  if (!upstreamBase) {
    res.status(500).json({ error: 'misconfigured', detail: `no upstream configured for topic ${parsed.topic}` });
    return;
  }
  const upstreamUrl = `${upstreamBase}/agent/${parsed.topic}${parsed.rest}${query}`;
  const upstreamHeaders: Record<string, string> = {
    'x-internal-token': internalToken,
  };
  const incomingContentType = req.headers['content-type'];
  if (typeof incomingContentType === 'string') {
    upstreamHeaders['content-type'] = incomingContentType;
  }
  const accept = req.headers['accept'];
  if (typeof accept === 'string') {
    upstreamHeaders['accept'] = accept;
  }

  let body: string | undefined;
  if (req.method && !['GET', 'HEAD'].includes(req.method)) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (!upstreamHeaders['content-type']) {
      upstreamHeaders['content-type'] = 'application/json';
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method ?? 'POST',
      headers: upstreamHeaders,
      body,
    });
  } catch (err) {
    res.status(502).json({ error: 'upstream_unreachable', detail: (err as Error).message });
    return;
  }

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    // Hop-by-hop headers shouldn't be forwarded by a proxy.
    if (['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
      return;
    }
    res.setHeader(key, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  // Stream the body chunk-by-chunk for SSE compatibility.
  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
};
