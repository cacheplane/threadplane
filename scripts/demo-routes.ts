/**
 * Vercel Build Output API v3 route table shared by scripts/assemble-demo.ts
 * and scripts/assemble-ag-ui-demo.ts.
 *
 * `/hero` and `/stage` exist only to be iframed by the threadplane.ai
 * homepage; indexed on their own they would be chrome-less search results.
 * `continue: true` applies the header and keeps routing, so the SPA fallback
 * below still serves them — the same shape scripts/assemble-examples.ts uses
 * for its CSP headers. The AG-UI demo has no such routes; the shared table
 * keeps both assemblers identical rather than special-casing one.
 *
 * robots.txt stays allow-all on purpose: `noindex` only takes effect on a
 * page the crawler is allowed to fetch.
 */
export const NOINDEX_ROUTE_PATTERN = '^/(hero|stage)(/.*)?$';

export interface VercelRoute {
  src?: string;
  dest?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  check?: boolean;
  handle?: 'filesystem';
}

export function demoRoutes(apiSrc: string): VercelRoute[] {
  return [
    { src: NOINDEX_ROUTE_PATTERN, headers: { 'X-Robots-Tag': 'noindex' }, continue: true },
    { src: apiSrc, dest: '/api/[[...path]]', check: true },
    { handle: 'filesystem' },
    { src: '.*', dest: '/index.html' },
  ];
}
