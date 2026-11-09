// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import * as docs from '../../../../lib/docs';
import { GET } from './route';

afterEach(() => vi.restoreAllMocks());

it('exports the same adapter source as the article with the Markdown response contract', async () => {
  const doc = docs.getSpecialDocByPath('/docs/choosing-an-adapter');
  expect(doc).not.toBeNull();
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe(
    'text/markdown; charset=utf-8'
  );
  expect(response.headers.get('Cache-Control')).toBe(
    'public, max-age=60, must-revalidate'
  );
  expect(await response.text()).toBe(doc?.content);
});

it('returns an uncached 404 if the registered article source is missing', async () => {
  vi.spyOn(docs, 'getSpecialDocByPath').mockReturnValue(null);
  const response = GET();
  expect(response.status).toBe(404);
  expect(response.headers.get('Content-Type')).toBe(
    'text/plain; charset=utf-8'
  );
  expect(response.headers.get('Cache-Control')).toBeNull();
  expect(await response.text()).toBe('Not found');
});
