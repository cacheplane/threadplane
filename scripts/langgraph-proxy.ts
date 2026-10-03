// scripts/langgraph-proxy.ts
/**
 * Vercel Node serverless function factory for proxying to a LangGraph
 * Cloud deployment. Injects `x-api-key` server-side from
 * `LANGSMITH_API_KEY`, streams SSE responses chunk-by-chunk, and
 * forwards all other content types verbatim.
 *
 * Shared between `scripts/examples-middleware.ts` (threadplane-examples
 * deployment) and `scripts/demo-middleware.ts` (canonical demo
 * deployment). Per-deployment specifics — like the examples'
 * Referer-based backend routing — are passed in via `ProxyConfig`.
 */

// Types only - Vercel provides these at runtime.
export interface VercelRequest {
  method?: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  url?: string;
  query: Record<string, string | string[]>;
}

export interface VercelResponse {
  setHeader(k: string, v: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): void;
  write(chunk: string): void;
  end(): void;
  send(body: string): void;
}

export interface ProxyConfig {
  /** Default upstream URL when `resolveBackend` is not provided or returns
   *  the same value. Required if `resolveBackend` is omitted. */
  readonly backendUrl?: string;
  /** Optional dynamic backend resolver. Receives the request's `referer`
   *  header. The default-export wrappers use this for examples (which has
   *  a Referer-based fan-out) and the demo (which has a single backend). */
  readonly resolveBackend?: (referer: string | undefined) => string;
  /** Optional rate-limit gate. When provided, the proxy calls this for
   *  POST /api/threads/{id}/runs/stream requests before forwarding. If the
   *  result has allowed=false, returns 429 with Retry-After. The demo
   *  wraps `checkRateLimit` from scripts/rate-limit.ts; examples leaves
   *  it unset. */
  readonly checkRateLimit?: (ip: string) => Promise<{ allowed: boolean; retryAfterSec: number; count: number }>;
  /** Origins to allow via CORS. If undefined, legacy wildcard `*` behavior
   *  preserved (used by threadplane-examples). Each entry is a full origin
   *  string, e.g. `https://demo.threadplane.ai`. Match is exact-string. */
  readonly allowedOrigins?: readonly string[];
  /** Maximum request body size in bytes. If undefined, no cap (legacy
   *  behavior). Checked against Content-Length first, falls back to
   *  JSON.stringify(req.body).length. */
  readonly maxBodyBytes?: number;
  /** Optional first-party ingest endpoint for browser telemetry. When set,
   *  POST /api/ingest is forwarded here instead of the LangGraph backend.
   *  This keeps the browser-facing telemetry API vendor-neutral while the
   *  deployment owns its server-side analytics boundary. */
  readonly telemetryIngestUrl?: string;
}

const DEFAULT_BACKEND_URL = 'https://cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f.us.langgraph.app';

const STREAM_RUN_PATH_RE = /^\/threads\/[^/]+\/runs\/stream$/;

function extractIp(headers: Record<string, string | undefined>): string {
  const fwd = headers['x-forwarded-for'];
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers['x-real-ip'];
  if (real) return real.trim();
  return `unknown:${Math.random().toString(36).slice(2, 10)}`;
}

function objectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

export function createProxyHandler(config: ProxyConfig = {}): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  const fallbackBackend = config.backendUrl ?? DEFAULT_BACKEND_URL;
  const resolveBackend = config.resolveBackend ?? ((_referer) => fallbackBackend);

  return async function handler(req, res) {
    // CORS — echo matching Origin when allowedOrigins is configured;
    // otherwise legacy * behavior preserved for threadplane-examples.
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, x-api-key, authorization');

    const origin = req.headers.origin;
    if (config.allowedOrigins) {
      if (origin) {
        if (config.allowedOrigins.includes(origin)) {
          res.setHeader('access-control-allow-origin', origin);
          res.setHeader('vary', 'origin');
        } else {
          res.status(403).json({ error: 'origin_not_allowed' });
          return;
        }
      }
      // No Origin header → server-to-server client, skip CORS headers.
    } else {
      res.setHeader('access-control-allow-origin', '*');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    // Build target URL metadata once — strip /api prefix from req.url, drop the
    // Vercel catch-all query param, keep real query params.
    const parsedUrl = new URL(req.url ?? '', `https://${req.headers.host ?? 'localhost'}`);
    const apiPath = parsedUrl.pathname.replace(/^\/api/, '') || '/';
    parsedUrl.searchParams.delete('[...path]');
    parsedUrl.searchParams.delete('[[...path]]');
    const cleanSearch = parsedUrl.searchParams.toString() ? `?${parsedUrl.searchParams.toString()}` : '';

    if (config.telemetryIngestUrl && apiPath === '/ingest') {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'method_not_allowed' });
        return;
      }
      try {
        const response = await fetch(config.telemetryIngestUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...objectBody(req.body),
            key: 'phc_public_cacheplane_telemetry',
          }),
        });
        const contentType = response.headers.get('content-type') ?? 'application/json';
        res.setHeader('content-type', contentType);
        res.status(response.status);
        res.send(await response.text());
      } catch (err) {
        res.status(502).json({ error: 'Telemetry ingest error', message: (err as Error).message });
      }
      return;
    }

    const apiKey = process.env['LANGSMITH_API_KEY'];
    if (!apiKey) {
      res.status(500).json({ error: 'LANGSMITH_API_KEY not configured' });
      return;
    }

    const backendUrl = resolveBackend(req.headers.referer);
    const targetUrl = `${backendUrl}${apiPath}${cleanSearch}`;

    // Body-size cap. Fast-fail before rate-limit + upstream fetch.
    if (config.maxBodyBytes !== undefined) {
      const cl = req.headers['content-length'];
      const clNum = cl !== undefined ? Number(cl) : NaN;
      let actualBytes: number;
      if (Number.isFinite(clNum) && clNum >= 0) {
        actualBytes = clNum;
      } else {
        actualBytes = JSON.stringify(req.body ?? '').length;
      }
      if (actualBytes > config.maxBodyBytes) {
        res.status(413).json({
          error: 'payload_too_large',
          maxBytes: config.maxBodyBytes,
          actualBytes,
        });
        return;
      }
    }

    // Rate-limit gate: only POST /api/threads/{id}/runs/stream burns OpenAI tokens.
    if (
      config.checkRateLimit &&
      req.method === 'POST' &&
      STREAM_RUN_PATH_RE.test(apiPath)
    ) {
      const ip = extractIp(req.headers);
      const { allowed, retryAfterSec } = await config.checkRateLimit(ip);
      if (!allowed) {
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({
          error: 'rate_limit_exceeded',
          retryAfterSec,
          message: `Demo is rate-limited per IP. Try again in ${retryAfterSec}s.`,
        });
        return;
      }
    }

    console.log(`[proxy] ${req.method} ${req.url} → ${targetUrl}`);

    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      'content-type': req.headers['content-type'] ?? 'application/json',
    };

    try {
      const response = await fetch(targetUrl, {
        method: req.method ?? 'GET',
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      });

      const contentType = response.headers.get('content-type') ?? 'application/json';
      res.setHeader('content-type', contentType);
      res.status(response.status);

      if (contentType.includes('text/event-stream')) {
        // The SDK captures physical run identity from this upstream header.
        // Keep it available before streaming without forwarding other headers.
        const location = response.headers.get('content-location');
        if (location) {
          res.setHeader('content-location', location);
          res.setHeader('access-control-expose-headers', 'content-location');
        }
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        }
        res.end();
      } else {
        const text = await response.text();
        res.send(text);
      }
    } catch (err) {
      res.status(502).json({ error: 'Proxy error', message: (err as Error).message });
    }
  };
}
