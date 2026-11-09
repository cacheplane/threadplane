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

function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
  fireEvent.click(
    screen.getByRole('menuitemradio', { name: option, exact: true })
  );
}

describe('API reference UI', () => {
  it('starts with compact entrypoint cards, including empty unpublished packages', () => {
    const { container } = render(
      <ApiIndexView index={{ ...index, symbols: [] }} />
    );
    expect(screen.getByRole('status').textContent).toContain('2 entrypoints');
    expect(
      container.querySelectorAll('.api-reference-entrypoint-card')
    ).toHaveLength(2);
    expect(
      screen
        .getByRole('link', { name: '@threadplane/react/chat' })
        .getAttribute('href')
    ).toBe('/docs/api/react/chat');
    expect(screen.getByText('Unpublished')).toBeTruthy();
    expect(screen.queryByText('v0.0.0')).toBeNull();
    expect(screen.getByText('v0.3.3')).toBeTruthy();
    expect(screen.getAllByText('0 exports')).toHaveLength(2);
    expect(screen.getAllByText(/Conversation components/)).toHaveLength(2);
  });

  it('filters entrypoint cards by scope, then searches exports and clears back to that scope', () => {
    render(<ApiIndexView index={index} />);
    choose('Framework', 'React');
    expect(
      screen.queryByRole('link', { name: '@threadplane/chat' })
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Chat' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Find an API'), {
      target: { value: 'Chat' },
    });
    expect(screen.getByRole('link', { name: 'Chat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('status').textContent).toContain('1 entrypoint');
    expect(screen.queryByRole('link', { name: 'Chat' })).toBeNull();
  });

  it('keeps package routes as symbol lists and preserves the package when clearing', () => {
    render(<ApiIndexView index={index} entrypointId="chat" />);
    expect(screen.getByRole('link', { name: 'ChatComponent' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Chat' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Find an API'), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No APIs match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('link', { name: 'ChatComponent' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Chat' })).toBeNull();
  });

  it('shows exports for an import or kind selection without a name query', () => {
    render(<ApiIndexView index={index} />);
    choose('Import path', '@threadplane/react/chat');
    expect(screen.getByRole('link', { name: 'Chat' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'ChatComponent' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    choose('Kind', 'Class');
    expect(screen.getByRole('link', { name: 'ChatComponent' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Chat' })).toBeNull();
  });
  it('clears an unavailable kind when switching framework scope', () => {
    render(<ApiIndexView index={index} />);
    choose('Kind', 'Class');
    choose('Framework', 'React');
    expect(
      screen.getByRole('link', { name: '@threadplane/react/chat' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kind' }).textContent).toContain(
      'All kinds'
    );
  });
  it('clears an incompatible import when the framework changes', () => {
    render(<ApiIndexView index={index} />);
    choose('Import path', '@threadplane/chat');
    choose('Framework', 'React');
    expect(
      screen.getByRole('link', { name: '@threadplane/react/chat' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import path' }));
    expect(
      screen.queryByRole('menuitemradio', { name: '@threadplane/chat' })
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
    expect(
      screen.getByRole('link', { name: '@threadplane/react/chat' })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '@threadplane/chat' })
    ).toBeTruthy();
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
    expect(screen.getByText('1 export')).toBeTruthy();
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
    choose('Framework', 'React');
    fireEvent.change(screen.getByLabelText('Find an API'), {
      target: { value: 'Chat' },
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
