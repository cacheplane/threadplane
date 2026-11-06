import { describe, expect, it } from 'vitest';
import {
  docsNarrativeHref,
  parseDocsNarrativePath,
  type DocsNarrativeIdentity,
} from './docs-routes';

const narratives: readonly [DocsNarrativeIdentity, string][] = [
  [
    {
      scope: 'framework',
      framework: 'react',
      slug: ['langgraph', 'guides', 'streaming'],
    },
    '/docs/react/langgraph/guides/streaming',
  ],
  [
    {
      scope: 'framework',
      framework: 'angular',
      slug: ['getting-started', 'introduction'],
    },
    '/docs/angular/getting-started/introduction',
  ],
  [
    { scope: 'shared', slug: ['middleware', 'overview'] },
    '/docs/shared/middleware/overview',
  ],
  [
    { scope: 'shared', slug: ['café', 'tool calls'] },
    '/docs/shared/caf%C3%A9/tool%20calls',
  ],
];

describe('docsNarrativeHref', () => {
  it.each(narratives)('builds the canonical path for %j', (identity, href) => {
    expect(docsNarrativeHref(identity)).toBe(href);
  });

  it.each([
    { scope: 'framework', framework: 'vue', slug: ['introduction'] },
    { scope: 'framework', framework: 'shared', slug: ['introduction'] },
    { scope: 'other', slug: ['introduction'] },
    { scope: 'shared', slug: [] },
    { scope: 'shared', slug: new Array(1) },
    { scope: 'shared', slug: [''] },
    { scope: 'shared', slug: ['.'] },
    { scope: 'shared', slug: ['..'] },
    { scope: 'shared', slug: ['a/b'] },
    { scope: 'shared', slug: ['a\\b'] },
    { scope: 'shared', slug: ['%2e%2e'] },
    { scope: 'shared', slug: ['\u0000'] },
    { scope: 'shared', slug: ['\n'] },
    { scope: 'shared', slug: [' intro'] },
    { scope: 'shared', slug: ['intro '] },
    { scope: 'shared', slug: ['\ud800'] },
    { scope: 'shared', slug: 'introduction' },
    { scope: 'shared', slug: [null] },
    null,
  ])('rejects invalid identities: %j', (identity) => {
    expect(() =>
      docsNarrativeHref(identity as DocsNarrativeIdentity)
    ).toThrow();
  });
});

describe('parseDocsNarrativePath', () => {
  it.each(narratives)(
    'parses the canonical identity for %j',
    (identity, href) => {
      expect(parseDocsNarrativePath(href)).toEqual(identity);
    }
  );

  it('keeps the route authoritative over unrelated query and fragment data', () => {
    expect(
      parseDocsNarrativePath(
        '/docs/react/langgraph/guides/streaming?frontend=angular#usage'
      )
    ).toEqual(narratives[0][0]);
    expect(
      parseDocsNarrativePath(
        '/docs/react/langgraph/guides/streaming#usage?frontend=angular'
      )
    ).toEqual(narratives[0][0]);
  });

  it('decodes each segment independently, preserving encoded query delimiters', () => {
    const identity: DocsNarrativeIdentity = {
      scope: 'shared',
      slug: ['what?now#next'],
    };
    expect(docsNarrativeHref(identity)).toBe('/docs/shared/what%3Fnow%23next');
    expect(parseDocsNarrativePath(docsNarrativeHref(identity))).toEqual(
      identity
    );
  });

  it.each([
    '/docs',
    '/docs/api',
    '/docs/api/react/Session',
    '/docs/choosing-an-adapter',
    '/docs/langgraph/guides/streaming',
    '/docs/langgraph/guides/streaming?frontend=react',
    '/docs/vue/langgraph/guides/streaming',
    '/docs/React/langgraph/guides/streaming',
    '/docs/react',
    '/docs/shared',
    '/docs/react/',
    '/docs/shared/',
    '/docs/react//streaming',
    '/docs/react/streaming/',
    '/docs/react/../shared/overview',
    '/docs/react/./overview',
    '/docs/react/%2e%2e/overview',
    '/docs/react/a%2fb',
    '/docs/react/a%5cb',
    '/docs/react/%252e%252e',
    '/docs/react/%00',
    '/docs/react/%0a',
    '/docs/react/%20intro',
    '/docs/react/intro%20',
    '/docs/react/%',
    '/docs/react/%C0%AF',
    '/docs/react/a\\b',
    '/docs/react/\ud800',
    'docs/react/overview',
    '//docs/react/overview',
    'https://threadplane.com/docs/react/overview',
  ])('does not resolve invalid or non-narrative paths: %s', (path) => {
    expect(parseDocsNarrativePath(path)).toBeNull();
  });
});
