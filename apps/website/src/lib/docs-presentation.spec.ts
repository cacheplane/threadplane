import { expect, test } from 'vitest';
import { isDocsReadingRoute } from './docs-presentation';

test.each([
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
  '/docs',
  '/docs/examples',
  '/docs/choosing-an-adapter',
  '/examples/angular/ag-ui/streaming',
  '/docs/apiary',
  '/docs/angularish/example',
])('keeps landing and runtime surfaces separate: %s', (path) => {
  expect(isDocsReadingRoute(path)).toBe(false);
});
