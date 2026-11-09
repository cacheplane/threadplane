// @vitest-environment jsdom
import React from 'react';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocsLandingPage from './page';
import ChoosingAnAdapterPage from './choosing-an-adapter/page';
import { WebsiteWorkspaceRoot } from '../../components/workspace/WebsiteWorkspaceRoot';
import { FRAMEWORK_PREFERENCE_KEY } from '../../lib/framework-preference';

// Server-owned content is supplied as slots; exercise the real client registrar
// and persistent shell rather than substituting a mock workspace component.
vi.mock('../../lib/workspace-page', () => ({
  getWebsiteWorkspacePage: async ({
    docsPath,
    title,
  }: {
    docsPath: string;
    title: string;
  }) => ({
    resolution: {
      kind: 'docs-only',
      docsPath,
      title,
      unavailableReason: 'no-workspace-capability',
    },
    presentation: { kind: 'docs-only', docsPath, title, runnable: false },
    contentBundle: {
      codeFiles: {},
      codeSources: {},
      promptFiles: {},
      runtimeUrl: null,
      docSections: [],
    },
    navigationTree: [],
    runFallbackSlot: <article>Example directory</article>,
    apiSlot: <article>Generated API reference</article>,
  }),
}));

vi.mock('../../components/docs/MdxRenderer', () => ({
  MdxRenderer: () => (
    <div className="docs-prose">
      <h1>Choosing an adapter</h1>
      <h2 id="at-a-glance">At a glance</h2>
    </div>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/docs');
});

const renderLanding = async () =>
  render(
    <WebsiteWorkspaceRoot>{await DocsLandingPage()}</WebsiteWorkspaceRoot>
  );

describe('docs index', () => {
  it('starts each framework at its own quickstart', async () => {
    await renderLanding();
    for (const framework of ['Angular', 'React']) {
      expect(
        screen
          .getByRole('link', { name: new RegExp(`Start with ${framework}`) })
          .getAttribute('href')
      ).toBe(`/docs/${framework.toLowerCase()}/getting-started/quickstart`);
    }
  });
  it('keeps install-copy controls outside navigation links', async () => {
    await renderLanding();
    for (const summary of screen.getAllByText('Angular install command'))
      fireEvent.click(summary);
    const buttons = screen.getAllByRole('button', {
      name: 'Copy install command',
    });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.closest('a')).toBeNull();
  });

  it('wears the same control plane as every other docs route', async () => {
    await renderLanding();

    expect(screen.queryByRole('heading', { name: 'Scope' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search docs' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Choose a library' })
    ).toBeTruthy();
  });

  it('keeps the landing content out of the prose measure', async () => {
    const { container } = await renderLanding();

    // The card grids need their own width; the [slug] route's md:max-w-3xl
    // article measure would flatten them into a single column.
    const body = container.querySelector('.docs-index-body');
    expect(body).toBeTruthy();
    expect(body?.className).not.toContain('max-w-3xl');
  });

  it('calls the render library what the docs call it', async () => {
    await renderLanding();

    // The picker menu is closed on mount, so its labels are not in the DOM
    // until it is opened. Asserting without this click passes even when
    // docsConfig still says "Render" — it only ever sees the index card.
    fireEvent.click(screen.getByRole('button', { name: 'Choose a library' }));
    const menu = screen.getByRole('menu');
    const pickerNames = within(menu)
      .getAllByRole('menuitemradio')
      .map(
        (item) =>
          item.querySelector('.docs-sidebar-lib-item-title')?.textContent
      );

    // 85 occurrences of "json-render" across docs content vs one "Render" in
    // docsConfig. With the control plane on this page both labels are on
    // screen at once, so they have to agree.
    expect(pickerNames).toContain('json-render');
    expect(pickerNames).not.toContain('Render');
  });

  it.each([
    ['/docs', DocsLandingPage],
    ['/docs/choosing-an-adapter', ChoosingAnAdapterPage],
  ] as const)(
    'registers %s with the persistent toolbar and fallback modes',
    async (pathname, page) => {
      window.history.replaceState({}, '', pathname);
      const { container } = render(
        <WebsiteWorkspaceRoot>{await page()}</WebsiteWorkspaceRoot>
      );
      const shell = container.querySelector('[data-workspace-shell]');
      expect(shell?.getAttribute('data-workspace-navigation-layout')).toBe(
        'toolbar'
      );
      expect(container.querySelector('[data-docs-control-plane]')).toBeNull();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Framework' })).toHaveLength(
        1
      );
      const modes = screen.getByRole('navigation', {
        name: 'Documentation modes',
      });
      expect(within(modes).getAllByRole('button')).toHaveLength(4);
      for (const icon of modes.querySelectorAll('svg')) {
        expect(icon.getAttribute('stroke-width')).toBe('2');
      }
      fireEvent.click(screen.getByRole('button', { name: 'Choose a library' }));
      expect(
        screen
          .getAllByRole('menuitemradio')
          .every((item) => item.getAttribute('aria-checked') === 'false')
      ).toBe(true);
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(
        within(modes)
          .getByRole('button', { name: /^Code/ })
          .getAttribute('aria-disabled')
      ).toBe('true');
      fireEvent.click(within(modes).getByRole('button', { name: /^Code/ }));
      expect(shell?.getAttribute('data-workspace-mode')).toBe('Docs');
      expect(window.location.pathname + window.location.search).toBe(pathname);
      fireEvent.click(
        within(modes).getByRole('button', { name: 'Run', exact: true })
      );
      expect(screen.getByText('Example directory')).toBeTruthy();
      fireEvent.click(
        within(modes).getByRole('button', { name: 'API', exact: true })
      );
      expect(screen.getByText('Generated API reference')).toBeTruthy();
      expect(container.querySelector('[data-workspace-shell]')).toBe(shell);
    }
  );

  it.each([DocsLandingPage, ChoosingAnAdapterPage])(
    'preserves the server-rendered article before workspace registration',
    async (page) => {
      const html = renderToString(
        <WebsiteWorkspaceRoot>{await page()}</WebsiteWorkspaceRoot>
      );
      expect(html).toContain('website-workspace-fallback');
      expect(html).toContain('docs-workspace-article');
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    }
  );

  it('keeps the shell and preferred framework while moving from the index to adapter guidance', async () => {
    window.localStorage.setItem(FRAMEWORK_PREFERENCE_KEY, 'react');
    const view = await renderLanding();
    const shell = view.container.querySelector('[data-workspace-shell]');
    window.history.replaceState({}, '', '/docs/choosing-an-adapter');
    view.rerender(
      <WebsiteWorkspaceRoot>
        {await ChoosingAnAdapterPage()}
      </WebsiteWorkspaceRoot>
    );
    expect(view.container.querySelector('[data-workspace-shell]')).toBe(shell);
    expect(
      screen.getByRole('button', { name: 'Framework' }).textContent
    ).toContain('React');
    expect(
      screen.getByRole('heading', { name: 'Choosing an adapter' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Page actions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    expect(
      screen
        .getByRole('menuitem', { name: 'View as Markdown' })
        .getAttribute('href')
    ).toBe('/api/markdown/choosing-an-adapter');
    expect(
      screen
        .getByRole('menuitem', { name: 'Edit on GitHub' })
        .getAttribute('href')
    ).toBe(
      'https://github.com/cacheplane/threadplane/edit/main/apps/website/content/docs/choosing-an-adapter/index.mdx'
    );
    expect(
      view.container
        .querySelector('.docs-toc')
        ?.closest('.docs-workspace-article')
    ).toBeTruthy();
  });
});
