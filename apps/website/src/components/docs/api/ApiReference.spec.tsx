import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiIndexView } from './ApiIndexView';
import { ApiMarkdown } from './ApiMarkdown';
import { ApiNavigation } from './ApiNavigation';
import type { ApiIndex } from '../../../lib/api-reference-model';

const index: ApiIndex = {
  schemaVersion: 1,
  undocumented: [],
  entrypoints: [
    {
      id: 'react/chat',
      importPath: '@threadplane/react/chat',
      packageName: '@threadplane/react',
      project: 'react',
      framework: 'react',
      version: '0.0.0',
      status: 'development',
    },
    {
      id: 'chat',
      importPath: '@threadplane/chat',
      packageName: '@threadplane/chat',
      project: 'chat',
      framework: 'angular',
      version: '0.3.3',
      status: 'published',
    },
  ],
  symbols: [
    {
      name: 'Chat',
      entrypointId: 'react/chat',
      kind: 'Function',
      href: '/docs/api/react/chat/Chat',
      canonicalReference: 'react!Chat:function',
      isDeprecated: true,
      summary: 'React conversation.',
    },
    {
      name: 'ChatComponent',
      entrypointId: 'chat',
      kind: 'Class',
      href: '/docs/api/chat/ChatComponent',
      canonicalReference: 'chat!ChatComponent:class',
      isDeprecated: false,
      summary: 'Angular conversation.',
    },
  ],
};
afterEach(cleanup);

describe('API reference UI', () => {
  it('filters by framework and name while keeping deprecated development symbols visible', () => {
    render(<ApiIndexView index={index} />);
    fireEvent.change(screen.getByLabelText('Framework'), {
      target: { value: 'react' },
    });
    expect(screen.queryByRole('link', { name: 'ChatComponent' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Chat' }).getAttribute('href')
    ).toBe('/docs/api/react/chat/Chat');
    expect(screen.getByText('Unpublished')).toBeTruthy();
    expect(screen.getByText('Deprecated')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find an API'), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No APIs match these filters.')).toBeTruthy();
  });

  it('uses generated entrypoints for navigation and marks the exact active symbol', () => {
    render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api/react/chat/Chat"
      />
    );
    expect(
      screen
        .getByRole('link', { name: 'Chat (deprecated)', hidden: true })
        .getAttribute('aria-current')
    ).toBe('page');
    expect(
      screen
        .getByRole('link', { name: '@threadplane/react/chat', hidden: true })
        .getAttribute('href')
    ).toBe('/docs/api/react/chat');
  });
  it('preserves frontend query state through API and guide navigation', () => {
    render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api/react/chat/Chat"
        resolveHref={(href) => `${href}?frontend=react`}
      />
    );
    expect(
      screen
        .getByRole('link', { name: 'Guides and examples' })
        .getAttribute('href')
    ).toBe('/docs?frontend=react');
    expect(
      screen
        .getByRole('link', { name: 'Chat (deprecated)', hidden: true })
        .getAttribute('href')
    ).toBe('/docs/api/react/chat/Chat?frontend=react');
  });

  it('renders documentation Markdown without executing HTML or unsafe links', () => {
    const { container } = render(
      <ApiMarkdown
        source={
          '**Useful** [type](/docs/api/core/Message) [bad](javascript:alert%281%29)\n\n<script>alert(1)</script>'
        }
      />
    );
    expect(screen.getByText('Useful').tagName).toBe('STRONG');
    expect(
      screen.getByRole('link', { name: 'type' }).getAttribute('href')
    ).toBe('/docs/api/core/Message');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});
