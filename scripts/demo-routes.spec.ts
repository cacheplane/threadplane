import { describe, expect, it } from 'vitest';
import { NOINDEX_ROUTE_PATTERN, demoRoutes } from './demo-routes';

const noindex = new RegExp(NOINDEX_ROUTE_PATTERN, 'u');

describe('demo routes', () => {
  it.each(['/hero', '/stage', '/hero/anything', '/stage/x/y'])('noindex matches %s', (path) => {
    expect(noindex.test(path)).toBe(true);
  });

  it.each(['/', '/embed', '/embed/thread-1', '/popup', '/sidebar', '/heroic', '/stages', '/api/x'])(
    'noindex does not match %s',
    (path) => {
      expect(noindex.test(path)).toBe(false);
    },
  );

  it('puts the noindex header route first, with continue so routing proceeds', () => {
    const [first] = demoRoutes('^/api/(.*)');
    expect(first).toEqual({
      src: NOINDEX_ROUTE_PATTERN,
      headers: { 'X-Robots-Tag': 'noindex' },
      continue: true,
    });
  });

  it('keeps the API route, filesystem handle and SPA fallback in order', () => {
    const routes = demoRoutes('^/agent(/.*)?$');
    expect(routes.slice(1)).toEqual([
      { src: '^/agent(/.*)?$', dest: '/api/[[...path]]', check: true },
      { handle: 'filesystem' },
      { src: '.*', dest: '/index.html' },
    ]);
  });
});
