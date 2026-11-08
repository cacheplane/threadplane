import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiIndexView } from './ApiIndexView';
import { ApiMarkdown } from './ApiMarkdown';
import { ApiNavigation } from './ApiNavigation';
import type { ApiIndex } from '../../../lib/api-reference-model';

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs/api',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

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
      docLibrary: 'chat',
      version: '0.0.0',
      status: 'development',
    },
    {
      id: 'chat',
      importPath: '@threadplane/chat',
      packageName: '@threadplane/chat',
      project: 'chat',
      framework: 'angular',
      docLibrary: 'chat',
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
  it('clears an unavailable kind when switching framework scope', () => {
    render(<ApiIndexView index={index} />);
    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'Class' },
    });
    fireEvent.change(screen.getByLabelText('Framework'), {
      target: { value: 'react' },
    });
    expect(screen.getByRole('link', { name: 'Chat' })).toBeTruthy();
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('');
  });
  it('clears an incompatible import when the framework changes', () => {
    render(<ApiIndexView index={index} />);
    fireEvent.change(screen.getByLabelText('Import path'), {
      target: { value: 'chat' },
    });
    fireEvent.change(screen.getByLabelText('Framework'), {
      target: { value: 'react' },
    });
    expect(screen.getByRole('link', { name: 'Chat' })).toBeTruthy();
    expect(
      screen.queryByRole('option', { name: '@threadplane/chat' })
    ).toBeNull();
  });

  it('exposes a mobile filter disclosure and resets a no-results search', () => {
    render(<ApiIndexView index={index} />);
    const toggle = screen.getByRole('button', { name: /^Filters/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(screen.getByLabelText('Find an API'), {
      target: { value: 'missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('link', { name: 'Chat' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ChatComponent' })).toBeTruthy();
  });

  it('drills into one navigation window at a time and restores the originating button on Back', () => {
    const { container } = render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api"
      />
    );
    expect(container.querySelector('details')).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Chat (deprecated)' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chat', exact: true }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '@threadplane/react/chat',
        exact: true,
      })
    );
    expect(
      screen.getByRole('link', { name: 'Chat (deprecated)' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: '@threadplane/chat', exact: true })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Chat' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: '@threadplane/react/chat',
        exact: true,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to libraries' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Chat', exact: true })
    );
  });

  it('opens the active export window directly and skips a redundant single-import level', () => {
    render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api/react/chat/Chat"
      />
    );
    expect(
      screen
        .getByRole('link', { name: 'Chat (deprecated)' })
        .getAttribute('aria-current')
    ).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Back to libraries' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chat', exact: true }));
    expect(
      screen.getByRole('link', { name: 'Chat (deprecated)' })
    ).toBeTruthy();
  });

  it('filters only exports in the current import and clears an empty search', () => {
    render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api/react/chat/Chat"
      />
    );
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Filter exports' }),
      { target: { value: 'missing' } }
    );
    expect(
      screen.queryByRole('link', { name: 'Chat (deprecated)' })
    ).toBeNull();
    expect(screen.getByText('No matching exports.')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear export search' })
    );
    expect(
      screen.getByRole('link', { name: 'Chat (deprecated)' })
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Filter exports' })
    );
  });
  it('supports list keys without consuming text-editing keys and leaves branch navigation in the drawer', () => {
    const onNavigate = vi.fn();
    render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api"
        onNavigate={onNavigate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chat', exact: true }));
    const heading = screen.getByRole('heading', { name: 'Chat', exact: true });
    fireEvent.keyDown(heading, { key: 'End' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '@threadplane/chat', exact: true })
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: '@threadplane/react/chat',
        exact: true,
      })
    );
    fireEvent.click(document.activeElement as HTMLElement);
    const search = screen.getByRole('searchbox', { name: 'Filter exports' });
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(search);
    expect(
      fireEvent.keyDown(
        screen.getByRole('link', { name: 'Chat (deprecated)' }),
        { key: 'ArrowLeft', altKey: true }
      )
    ).toBe(true);
    expect(
      screen.getByRole('searchbox', { name: 'Filter exports' })
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('link', { name: 'Chat (deprecated)' }), {
      key: 'ArrowLeft',
    });
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: '@threadplane/react/chat',
        exact: true,
      })
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps an overview for empty imports', () => {
    render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={[]}
        activeHref="/docs/api/react/chat"
      />
    );
    expect(
      screen
        .getByRole('link', { name: '@threadplane/react/chat' })
        .getAttribute('aria-current')
    ).toBe('page');
    expect(screen.getByText('No exported declarations.')).toBeTruthy();
  });

  it('reveals a newly selected symbol even when browsing another panel in the same package', () => {
    const view = render(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api/react/chat"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to libraries' }));
    view.rerender(
      <ApiNavigation
        entrypoints={index.entrypoints}
        symbols={index.symbols}
        activeHref="/docs/api/react/chat/Chat"
      />
    );
    expect(
      screen
        .getByRole('link', { name: 'Chat (deprecated)' })
        .getAttribute('aria-current')
    ).toBe('page');
  });

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
