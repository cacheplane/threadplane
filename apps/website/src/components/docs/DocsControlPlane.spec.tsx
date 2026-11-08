// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocsControlPlane, DocsContextContent } from './DocsControlPlane';
import { docsConfig } from '../../lib/docs-config';
import { declarationsFor } from '../../styles/style-contract';

const LIBRARY_TITLES = docsConfig
  .filter((l) => l.group === 'library')
  .map((l) => l.title);

const workspaceRoot = process.cwd().endsWith('/apps/website')
  ? resolve(process.cwd(), '../..')
  : process.cwd();
const docsCss = readFileSync(
  resolve(workspaceRoot, 'apps/website/src/styles/docs.css'),
  'utf8'
);

const { track, route } = vi.hoisted(() => ({
  track: vi.fn(),
  route: { pathname: '/docs/angular/langgraph/guides/streaming' },
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push }),
}));

vi.mock('../../lib/analytics/client', () => ({ track }));

beforeEach(() => {
  route.pathname = '/docs/angular/langgraph/guides/streaming';
  window.localStorage.clear();
  push.mockClear();
  track.mockClear();
});

describe('DocsControlPlane', () => {
  it('uses compact React navigation with framework-correct overview and collapsed inactive sections', () => {
    route.pathname = '/docs/react/ag-ui/guides/interrupts';
    const { container } = render(<DocsContextContent activeLibrary="ag-ui" activeSection="guides" activeSlug="interrupts" scope="react" />);
    expect(container.querySelector('[data-docs-navigation-compact]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'React overview' }).getAttribute('href')).toBe('/docs/react/getting-started/introduction');
    expect(screen.getByRole('button', { name: 'Reference', exact: true }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Guides', exact: true }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Interrupts', exact: true }).getAttribute('aria-current')).toBe('page');
  });
  it.each(['angular', 'react'] as const)('marks the %s introduction as the current featured page', framework => {
    route.pathname = `/docs/${framework}/getting-started/introduction`;
    render(<DocsContextContent activeLibrary={null} activeSection="getting-started" activeSlug="introduction" scope={framework} />);
    const introduction = screen.getByRole('link', { name: 'Introduction' });
    expect(introduction.getAttribute('aria-current')).toBe('page');
    expect(introduction.hasAttribute('data-active')).toBe(true);
  });
  it('keeps shared migrations last and collapsed until requested', () => {
    const { container } = render(<DocsContextContent activeLibrary="langgraph" activeSection="guides" activeSlug="streaming" />);
    const sections = container.querySelectorAll('.docs-sidebar-section');
    const last = sections[sections.length - 1];
    const migrations = within(last as HTMLElement).getByRole('button', { name: 'Migrations' });
    expect(migrations.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Upgrade an existing application' })).toBeNull();
    fireEvent.click(migrations);
    expect(screen.getByRole('link', { name: 'Upgrade an existing application' }).getAttribute('href')).toBe('/docs/angular/chat/migrations/upgrading');
  });

  it('preserves the selected frontend in documentation navigation', () => {
    route.pathname = '/docs/react/langgraph/guides/streaming';
    render(
      <DocsContextContent
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
        scope="react"
      />
    );
    expect(
      screen
        .getByRole('link', { name: 'Persistence' })
        .getAttribute('href')
    ).toBe('/docs/react/langgraph/guides/persistence');
    expect(screen.queryByRole('link', { name: 'Installation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Migrations' })).toBeNull();
  });

  it.each([false, true])('offers one framework selector in documentation navigation (mobile=%s)', mobile => {
    render(<DocsContextContent activeLibrary="langgraph" activeSection="guides" activeSlug="streaming" mobile={mobile} />);
    expect(screen.getAllByLabelText('Framework')).toHaveLength(1);
  });
  it('keeps context headings on the shared sentence-case sans contract', () => {
    for (const selector of [
      '[data-docs-control-plane-context] [data-control-plane-section-trigger]',
      '[data-docs-control-plane-context] [data-control-plane-section-heading]',
    ]) {
      const declarations = declarationsFor(docsCss, selector);
      expect(declarations).toMatch(/font-family:\s*var\(--font-sans\)/);
      expect(declarations).toMatch(/font-size:\s*12px/);
      expect(declarations).toMatch(/font-weight:\s*600/);
      expect(declarations).toMatch(/letter-spacing:\s*normal/);
      expect(declarations).toMatch(/color:\s*var\(--color-text-muted\)/);
      expect(declarations).toMatch(/text-transform:\s*none/);
    }
  });

  it('rotates the shared disclosure chevron as a complete icon', () => {
    const chevron = declarationsFor(
      docsCss,
      '[data-docs-control-plane-context] [data-control-plane-section-trigger] [data-control-plane-section-chevron]'
    );
    const expanded = declarationsFor(
      docsCss,
      '[data-docs-control-plane-context] [data-control-plane-section-trigger][aria-expanded="true"] [data-control-plane-section-chevron]'
    );

    expect(chevron).toMatch(/transition:[^;]*transform\s+150ms\s+ease/);
    expect(chevron).toMatch(/transform:\s*rotate\(0deg\)/);
    expect(expanded).toMatch(/transform:\s*rotate\(90deg\)/);
  });

  it('uses complete rounded sidebar states without a left marker', () => {
    for (const selector of [
      '.docs-sidebar-top-link',
      '.docs-sidebar-section-link',
    ]) {
      const declarations = declarationsFor(docsCss, selector);
      expect(declarations).toMatch(/border-radius:\s*7px/);
      expect(declarations).not.toMatch(
        /border-(?:left|inline-start)(?:-(?:color|style|width))?\s*:/
      );
    }

    const hover = declarationsFor(
      docsCss,
      '[data-docs-navlink]:not([data-active]):hover'
    );
    const active = declarationsFor(
      docsCss,
      '[data-docs-navlink][data-active]'
    );
    expect(hover).toMatch(/background:\s*var\(--color-surface-dim\)/);
    expect(active).toMatch(/background:\s*var\(--color-accent-surface\)/);
    expect(hover).not.toMatch(
      /border-(?:left|inline-start)(?:-(?:color|style|width))?\s*:/
    );
    expect(active).not.toMatch(
      /border-(?:left|inline-start)(?:-(?:color|style|width))?\s*:/
    );
  });

  it('does not retain style contracts for the retired Runtime preview or environment rows', () => {
    expect(docsCss).not.toMatch(/\[data-docs-runtime-preview\]/);
    expect(docsCss).not.toMatch(/\[data-control-plane-environment-/);
  });

  it('offers Run and API destinations while Code requires an example', () => {
    render(
      <DocsControlPlane
        activeLibrary={null}
        activeSection=""
        activeSlug=""
      />
    );

    const rail = screen.getByRole('navigation', { name: 'Docs modes' });
    expect(rail).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Docs' }).getAttribute('aria-current')
    ).toBe('page');
    expect(screen.getByRole('link', { name: 'Run' }).getAttribute('href')).toBe('/docs/examples');
    expect(screen.getByRole('link', { name: 'API' }).getAttribute('href')).toBe('/docs/api');
    for (const mode of ['Code'] as const) {
      const control = screen.getByRole('button', {
        name: mode,
        description: `${mode} is unavailable because this page has no workspace capability.`,
      });
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(control.getAttribute('href')).toBeNull();
      fireEvent.click(control);
    }
    expect(track).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Activity' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('renders Lucide rail and action icons with the accepted stroke', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    const rail = screen.getByRole('navigation', { name: 'Docs modes' });
    const icons = [
      ...rail.querySelectorAll('[data-control-plane-rail-icon] svg.lucide'),
      screen.getByRole('button', { name: 'Search docs' }).querySelector('svg'),
    ];
    expect(icons).toHaveLength(5);
    for (const icon of icons) {
      expect(icon?.getAttribute('stroke-width')).toBe('2');
    }
  });

  it('leads with search instead of restating the breadcrumb', () => {
    const listener = vi.fn();
    document.addEventListener('keydown', listener);
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    // The trail is the shell header's job now; a Scope card here said the
    // same thing a third time.
    expect(screen.queryByRole('heading', { name: 'Scope' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Search docs' }));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k', metaKey: true })
    );
    document.removeEventListener('keydown', listener);

    expect(screen.queryByRole('button', { name: 'Environment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Runtime' })).toBeNull();
    expect(screen.queryByText('Cockpit')).toBeNull();
  });

  it('drops the Actions bar when search was its only member', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    // LangGraph publishes no demoUrl, so nothing is left to put in Actions.
    expect(screen.queryByRole('toolbar', { name: 'Docs actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search docs' })).toBeTruthy();
  });

  it('connects nested Learn disclosures to their controlled content', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    const guides = screen.getByRole('button', { name: 'Guides' });
    const controlledId = guides.getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    if (!controlledId)
      throw new Error('Expected Guides to control its page links');
    expect(document.getElementById(controlledId)).toBeTruthy();
  });

  it('stacks the adapter title and tagline on separate lines', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'LangGraph' }));
    const item = screen.getByRole('menuitemradio', { name: /LangGraph/ });
    const title = item.querySelector('.docs-sidebar-lib-item-title');
    const tagline = item.querySelector('.docs-sidebar-lib-item-desc');
    if (!title || !tagline) throw new Error('Expected a title and a tagline');

    // The collision regression: both spans rendered inline on one line, so the
    // row read as "LangGraphTalk to LangGraph directly".
    expect(title.textContent).toBe('LangGraph');
    expect(tagline.textContent).toBe('Talk to LangGraph directly');
    const wrapper = title.parentElement;
    if (!wrapper) throw new Error('Expected a text wrapper');
    expect(wrapper.className).toContain('docs-sidebar-lib-item-text');
  });

  it('splits the menu into labelled adapter and library groups', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'LangGraph' }));
    const adapters = screen.getByRole('group', { name: 'Adapters' });
    const libraries = screen.getByRole('group', { name: 'Libraries' });

    // Adapters are asserted exactly: there are two, and only they carry
    // taglines. A new library must not quietly land in this group.
    expect(
      within(adapters)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent)
    ).toEqual([
      'LangGraphTalk to LangGraph directly',
      'AG-UIAny AG-UI backend',
    ]);
    // Libraries are checked against config so adding one does not churn this
    // test — misclassifying one still fails the assertion above.
    expect(
      within(libraries)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent)
    ).toEqual(LIBRARY_TITLES);
  });

  it('renders menu entries as real links with the current one checked', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'LangGraph' }));
    const agUi = screen.getByRole('menuitemradio', { name: /AG-UI/ });
    expect(agUi.tagName).toBe('A');
    expect(agUi.getAttribute('href')).toBe(
      '/docs/angular/ag-ui/getting-started/introduction'
    );
    expect(agUi.getAttribute('aria-checked')).toBe('false');
    expect(
      screen
        .getByRole('menuitemradio', { name: /LangGraph/ })
        .getAttribute('aria-checked')
    ).toBe('true');
  });

  it('caps the open menu to the space left below the trigger', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'LangGraph' }));
    const menu = screen.getByRole('menu');

    // A viewport-percentage cap cannot work: the menu opens ~342px down the
    // pane, so `60vh` still overflows a short window by ~100px. The cap has to
    // be measured from the trigger's own position.
    expect(menu.style.maxHeight).toMatch(/^\d+(\.\d+)?px$/);
  });

  it('supports keyboard entry and dismissal for the library menu', () => {
    render(
      <DocsControlPlane
        activeLibrary="langgraph"
        activeSection="guides"
        activeSlug="streaming"
      />
    );

    const trigger = screen.getByRole('button', { name: 'LangGraph' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const firstItem = screen.getByRole('menuitemradio', { name: /LangGraph/ });
    expect(document.activeElement).toBe(firstItem);

    // Traversal must still cross the Adapters/Libraries group boundary.
    fireEvent.keyDown(firstItem, { key: 'End' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', {
        name: LIBRARY_TITLES[LIBRARY_TITLES.length - 1],
      })
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(firstItem);

    fireEvent.keyDown(firstItem, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens on the selected library and supports title typeahead', () => {
    render(<DocsControlPlane activeLibrary="ag-ui" activeSection="guides" activeSlug="interrupts" />);
    fireEvent.click(screen.getByRole('button', { name: 'AG-UI' }));
    const selected = screen.getByRole('menuitemradio', { name: /AG-UI/ });
    expect(document.activeElement).toBe(selected);
    fireEvent.keyDown(selected, { key: 'c' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Chat' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AG-UI' }));
  });
});

describe('DocsControlPlane — library-neutral', () => {
  it('offers examples and generated APIs from the adapter comparison page', () => {
    render(
      <DocsControlPlane
        activeLibrary={null}
        activeSection=""
        activeSlug=""
      />,
    );

    expect(screen.getByRole('link', { name: 'Run' }).getAttribute('href')).toBe('/docs/examples');
    expect(screen.getByRole('link', { name: 'API' }).getAttribute('href')).toBe('/docs/api');
    for (const mode of ['Code'] as const) {
      const control = screen.getByRole('button', {
        name: mode,
        description: `${mode} is unavailable because this page has no workspace capability.`,
      });
      expect(control.getAttribute('href')).toBeNull();
      fireEvent.click(control);
    }
    expect(track).not.toHaveBeenCalled();
  });

  it('sends Run to the default example when the index supplies one', () => {
    render(
      <DocsControlPlane
        activeLibrary={null}
        activeSection=""
        activeSlug=""
        runHref="/docs/angular/langgraph/guides/streaming?mode=run"
      />,
    );

    // href turns the rail item into an <a>, so it is a link, not a button.
    expect(
      screen.getByRole('link', { name: 'Run' }).getAttribute('href'),
    ).toBe('/docs/angular/langgraph/guides/streaming?mode=run');

    expect(screen.getByRole('link', { name: 'API' }).getAttribute('href')).toBe('/docs/api');
    for (const mode of ['Code'] as const) {
      expect(
        screen.getByRole('button', {
          name: mode,
          description: `${mode} is unavailable because this page has no workspace capability.`,
        }).getAttribute('href'),
      ).toBeNull();
    }
  });

  it('offers search on a library-neutral page too', () => {
    render(
      <DocsControlPlane
        activeLibrary={null}
        activeSection=""
        activeSlug=""
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Scope' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search docs' })).toBeTruthy();
  });

  it('offers an unselected picker and no section tree', () => {
    render(
      <DocsControlPlane
        activeLibrary={null}
        activeSection=""
        activeSlug=""
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Choose a library' });
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.getAttribute('aria-checked') === 'false')).toBe(true);

    // No library means there is no section tree to show.
    expect(screen.queryByRole('button', { name: 'Getting Started' })).toBeNull();
  });
});

describe('DocsContextContent', () => {
  it('opens only the current Angular section by default', () => {
    render(<DocsContextContent activeLibrary="langgraph" activeSection="guides" activeSlug="streaming" />);
    expect(screen.getByRole('button', { name: 'Guides' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Getting Started' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('link', { name: 'Streaming' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Learn' })).toBeNull();
  });

  it('respects explicit Angular section preferences over the current section', () => {
    window.localStorage.setItem('threadplane:control-plane:v1', JSON.stringify({
      version: 1,
      docs: { expanded: { 'Learn:langgraph:guides': false, 'Learn:langgraph:getting-started': true } },
    }));
    render(<DocsContextContent activeLibrary="langgraph" activeSection="guides" activeSlug="streaming" />);
    expect(screen.getByRole('button', { name: 'Guides' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Getting Started' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the current migrations section without requiring a saved preference', () => {
    route.pathname = '/docs/angular/chat/migrations/upgrading';
    render(<DocsContextContent activeLibrary="chat" activeSection="migrations" activeSlug="upgrading" />);
    expect(screen.getByRole('button', { name: 'Migrations' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Upgrade an existing application' }).getAttribute('aria-current')).toBe('page');
  });

  it.each([false, true])('places the supplied framework control between search and library without duplication (mobile=%s)', mobile => {
    const { container } = render(<DocsContextContent activeLibrary="langgraph" activeSection="guides" activeSlug="streaming" mobile={mobile} frameworkSelector={<button data-framework-control>Owned framework selector</button>} />);
    expect(container.querySelectorAll('[data-framework-control]')).toHaveLength(1);
    const controls = Array.from(container.querySelectorAll('button'));
    expect(controls[0].textContent).toContain('Search docs');
    expect(controls[1].textContent).toBe('Owned framework selector');
    expect(controls[2].textContent).toBe('LangGraph');
  });

  it('keeps supporting Angular destinations below sections without a duplicate introduction', () => {
    const { container } = render(<DocsContextContent activeLibrary="ag-ui" activeSection="getting-started" activeSlug="introduction" />);
    expect(screen.getAllByRole('link', { name: 'Introduction' })).toHaveLength(1);
    const supporting = screen.getByRole('navigation', { name: 'More documentation' });
    expect(within(supporting).getByRole('link', { name: 'API Reference' }).getAttribute('href')).toBe('/docs/api');
    expect(within(supporting).getByRole('link', { name: 'Choosing an adapter' }).getAttribute('href')).toBe('/docs/choosing-an-adapter');
    expect((container.querySelector('.docs-sidebar-section')?.compareDocumentPosition(supporting) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open live demo' }).textContent).toBe('Open live demo');
  });

  it.each(['/docs/choosing-an-adapter', '/docs/examples'])('preserves the existing context structure outside reading pages (%s)', pathname => {
    route.pathname = pathname;
    const { container } = render(<DocsContextContent activeLibrary="langgraph" activeSection="guides" activeSlug="streaming" />);
    expect(screen.getByRole('button', { name: 'Learn' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Featured documentation' })).toBeTruthy();
    expect(container.querySelector('[data-docs-navigation-compact]')).toBeNull();
  });

  it.each(['/docs/shared/middleware/getting-started/introduction', '/docs/api'])('uses compact navigation for shared and API reading (%s)', pathname => {
    route.pathname = pathname;
    const { container } = render(<DocsContextContent activeLibrary="middleware" activeSection="getting-started" activeSlug="introduction" />);
    expect(screen.queryByRole('button', { name: 'Learn' })).toBeNull();
    expect(container.querySelector('[data-docs-navigation-compact]')).not.toBeNull();
  });

  it('reuses the same sentence-case navigation content for mobile', () => {
    render(
      <DocsContextContent
        activeLibrary="render"
        activeSection="guides"
        activeSlug="specs"
        mobile
      />
    );

    expect(screen.getByRole('button', { name: 'Search docs' })).toBeTruthy();
    // json-render publishes no demoUrl, so Actions has nothing left to hold.
    expect(screen.queryByRole('toolbar', { name: 'Docs actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Learn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Runtime' })).toBeNull();
  });

  it('keeps explicit standalone demo actions', () => {
    render(
      <DocsContextContent
        activeLibrary="ag-ui"
        activeSection="getting-started"
        activeSlug="introduction"
      />,
    );

    expect(screen.getByRole('button', { name: 'Search docs' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open live demo' }).getAttribute('href'),
    ).toBe(
      'https://ag-ui.threadplane.ai',
    );
  });
});
