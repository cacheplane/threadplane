// @vitest-environment node
import { expect, test } from 'vitest';
import {
  geometryIssues,
  requestDisposition,
  navigationIssue,
  DOCS_AUDIT_ROUTES,
} from './docs-audit-checks';

test('read-only browser audit blocks analytics and rejects application writes without leaking URLs', () => {
  expect(
    requestDisposition(
      'GET',
      'https://threadplane.ai/docs',
      'https://threadplane.ai'
    )
  ).toBe('allow');
  expect(
    requestDisposition(
      'POST',
      'https://threadplane.ai/ingest/e',
      'https://threadplane.ai'
    )
  ).toBe('analytics');
  expect(
    requestDisposition(
      'POST',
      'https://other.test/ingest/e',
      'https://threadplane.ai'
    )
  ).toBe('reject');
  expect(
    requestDisposition(
      'POST',
      'https://threadplane.ai/api/agent',
      'https://threadplane.ai'
    )
  ).toBe('reject');
  expect(
    navigationIssue(
      'https://threadplane.ai',
      'https://name:secret@other.test/docs?key=secret'
    )
  ).not.toContain('secret');
  expect(
    navigationIssue('https://threadplane.ai', 'https://threadplane.ai/docs')
  ).toBeUndefined();
});

test('geometry rejects fallback fonts, overlap, clipped labels, and page overflow', () => {
  const clean = {
    viewportWidth: 320,
    documentWidth: 320,
    fontsLoaded: true,
    canvas: { x: 0, y: 0, width: 600, height: 200 },
    nodes: [{ id: 'a', box: { x: 10, y: 10, width: 100, height: 100 } }],
    texts: [
      {
        text: 'label',
        node: 'a',
        box: { x: 20, y: 20, width: 50, height: 20 },
      },
    ],
  };
  expect(geometryIssues(clean)).toEqual([]);
  expect(geometryIssues({ ...clean, fontsLoaded: false })).toContain(
    'Required diagram font did not load'
  );
  expect(geometryIssues({ ...clean, documentWidth: 601 })).toContain(
    'Document overflows the viewport'
  );
  expect(
    geometryIssues({
      ...clean,
      texts: [
        {
          text: 'wide',
          node: 'a',
          box: { x: 20, y: 20, width: 200, height: 20 },
        },
      ],
    })
  ).toContain('Text outside node: wide');
  expect(
    geometryIssues({
      ...clean,
      nodes: [
        ...clean.nodes,
        { id: 'b', box: { x: 11, y: 11, width: 100, height: 100 } },
      ],
    })
  ).toContain('Nodes overlap: a / b');
});

test('central route inventory includes both supported framework readings and all diagram kinds', () => {
  expect(
    DOCS_AUDIT_ROUTES.filter((route) => route.video).map((route) => route.path)
  ).toEqual([
    '/docs/langgraph/concepts/conversation-turns',
    '/docs/langgraph/guides/streaming',
    '/docs/langgraph/guides/persistence',
    '/docs/chat/guides/client-tools',
    '/docs/render/guides/specs',
    '/docs/langgraph/guides/streaming?frontend=react',
    '/docs/langgraph/guides/persistence?frontend=react',
    '/docs/chat/guides/client-tools?frontend=react',
    '/docs/render/guides/specs?frontend=react',
  ]);
  expect(new Set(DOCS_AUDIT_ROUTES.map((route) => route.path)).size).toBe(
    DOCS_AUDIT_ROUTES.length
  );
  expect(
    DOCS_AUDIT_ROUTES.some((route) =>
      route.path.endsWith('/conversation-turns')
    )
  ).toBe(true);
});
