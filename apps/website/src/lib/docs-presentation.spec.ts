import { expect, test } from 'vitest';
import { isDocsReadingRoute } from './docs-presentation';

test.each([
  '/docs',
  '/docs/examples',
  '/docs/choosing-an-adapter',
  '/docs/apiary',
  '/docs/angularish/example',
  '/docs/angular/ag-ui/guides/tool-views',
  '/docs/react/ag-ui/guides/interrupts',
  '/docs/shared/middleware/getting-started/introduction',
  '/docs/api',
  '/docs/api/render/RenderSpecComponent',
])('uses the shared reading layout for %s', (path) => {
  expect(isDocsReadingRoute(path)).toBe(true);
});

test.each([
  undefined,
  null,
  '/',
  '/examples/angular/ag-ui/streaming',
  '/docs-other',
])('keeps runtime surfaces separate: %s', (path) => {
  expect(isDocsReadingRoute(path)).toBe(false);
});
