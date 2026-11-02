// @vitest-environment node
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { websiteContentCatalog } from './website-content';
import { apiPagePaths, readApiIndex } from '../api-reference';

it('registers generated API destinations instead of constructing retired MDX paths', () => {
  const catalog = websiteContentCatalog();
  expect(catalog['/docs/api/react/chat']).toBeDefined();
  expect(catalog['/docs/chat/api/react/chat']).toBeUndefined();
  expect(catalog['/docs/api']).toBeDefined();
});

it('catalogs every generated API route with a distinct validated content identity', () => {
  const catalog = websiteContentCatalog();
  const paths = apiPagePaths(readApiIndex());
  for (const path of paths) {
    expect(catalog[path], path).toBeDefined();
    expect(catalog[path].contentId).toMatch(/^[a-z0-9][a-z0-9_/-]{0,119}$/u);
    expect(catalog[path].topic).toBe(
      path === '/docs/api' ? 'getting_started' : 'architecture'
    );
  }
  expect(new Set(paths.map((path) => catalog[path].contentId)).size).toBe(
    paths.length
  );
  expect(catalog['/docs/api/react/NotAnExport']).toBeUndefined();
});
