// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GET, generateStaticParams } from './route';

describe('generated API Markdown route', () => {
  it.each([
    {
      segments: ['react', 'useAgent'],
      imported: '@threadplane/react',
      declaration: 'function useAgent',
      published: false,
    },
    {
      segments: ['angular', 'observeAgent'],
      imported: '@threadplane/angular',
      declaration: 'function observeAgent',
      published: true,
    },
    {
      segments: ['angular', 'testing', 'provideFakeAgent'],
      imported: '@threadplane/angular/testing',
      declaration: 'function provideFakeAgent',
      published: true,
    },
    {
      segments: ['langgraph', 'createSession'],
      imported: '@threadplane/langgraph',
      declaration: 'function createSession',
      published: true,
    },
    {
      segments: ['react', 'chat', 'ChatInput'],
      imported: '@threadplane/react/chat',
      declaration: 'ForwardRefExoticComponent',
      published: false,
    },
  ])(
    'serves extracted $imported declarations',
    async ({ segments, imported, declaration, published }) => {
      const response = await GET(
        new Request('https://threadplane.ai/api/markdown/api'),
        { params: Promise.resolve({ segments }) }
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      const body = await response.text();
      expect(body).toContain(imported);
      expect(body).toContain(declaration);
      // Only a private package is labelled; the Angular binding and the
      // backend session packages are published.
      if (published) expect(body).not.toContain('Unpublished development API');
      else expect(body).toContain('Unpublished development API');
    }
  );

  it('rejects unknown imports and symbols', async () => {
    const response = await GET(
      new Request('https://threadplane.ai/api/markdown/api'),
      { params: Promise.resolve({ segments: ['react', 'Unknown'] }) }
    );
    expect(response.status).toBe(404);
  });
  it('serves a package index for grouped legacy reference links', async () => {
    const response = await GET(
      new Request('https://threadplane.ai/api/markdown/api'),
      { params: Promise.resolve({ segments: ['middleware', 'langgraph'] }) }
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('@threadplane/middleware/langgraph');
    expect(body).toContain('/docs/api/middleware/langgraph/bindClientTools');
  });

  it('includes explicit secondary entrypoints in static generation', () => {
    expect(generateStaticParams()).toContainEqual({
      segments: ['react', 'chat', 'ChatInput'],
    });
  });
});
