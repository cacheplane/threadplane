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

test('network geometry rejects unrelated-node label collisions and shrinking', () => {
  const clean = {
    viewportWidth: 1440,
    documentWidth: 1440,
    fontsLoaded: true,
    canvas: { x: 0, y: 0, width: 640, height: 300 },
    naturalWidth: 640,
    articleWidth: 700,
    nodes: [{ id: 'a', box: { x: 10, y: 10, width: 180, height: 80 } }],
    texts: [
      { text: 'connection', box: { x: 250, y: 100, width: 100, height: 20 } },
    ],
  };
  expect(geometryIssues(clean)).toEqual([]);
  expect(
    geometryIssues({
      ...clean,
      texts: [
        { text: 'connection', box: { x: 20, y: 20, width: 100, height: 20 } },
      ],
    })
  ).toContain('Relationship label overlaps node: connection');
  expect(
    geometryIssues({ ...clean, canvas: { ...clean.canvas, width: 500 } })
  ).toContain('Diagram shrunk below natural size');
  expect(geometryIssues({ ...clean, articleWidth: 600 })).toContain(
    'Diagram overflows desktop article'
  );
  expect(
    geometryIssues({
      ...clean,
      viewportWidth: 320,
      documentWidth: 320,
      articleWidth: 280,
    })
  ).toEqual([]);
});

test('central route inventory includes both supported framework readings and all diagram kinds', () => {
  expect(
    DOCS_AUDIT_ROUTES.filter((route) => route.video).map((route) => route.path)
  ).toEqual([
    '/docs/angular/langgraph/concepts/conversation-turns',
    '/docs/angular/langgraph/guides/streaming',
    '/docs/angular/langgraph/guides/persistence',
    '/docs/angular/chat/guides/client-tools',
    '/docs/angular/render/guides/specs',
    '/docs/react/langgraph/guides/streaming',
    '/docs/react/langgraph/guides/persistence',
    '/docs/react/chat/guides/client-tools',
    '/docs/react/render/guides/specs',
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
