// @vitest-environment node
import { expect, it } from 'vitest';
import { GET } from './route';
import { GET as shared } from '../../shared/[...slug]/route';
const request = new Request('http://localhost');
it.each(['angular', 'react'])(
  'exports exact %s narrative',
  async (framework) => {
    const response = await GET(request, {
      params: Promise.resolve({
        framework,
        slug: ['langgraph', 'guides', 'streaming'],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/markdown');
    const body = await response.text();
    expect(body).toContain('#');
    if (framework === 'react') expect(body).toContain('React');
  }
);
it.each(['vue', 'langgraph'])(
  'rejects unknown or retired route prefix %s',
  async (framework) => {
    const response = await GET(request, {
      params: Promise.resolve({ framework, slug: ['guides', 'streaming'] }),
    });
    expect(response.status).toBe(404);
  }
);
it('exports shared docs once', async () => {
  const response = await shared(request, {
    params: Promise.resolve({
      slug: ['middleware', 'getting-started', 'introduction'],
    }),
  });
  expect(response.status).toBe(200);
});
