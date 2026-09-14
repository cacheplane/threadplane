// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Nav } from './Nav';

const { trackCtaClick, trackExternalLinkClick, pathnameRef } = vi.hoisted(() => ({
  trackCtaClick: vi.fn(),
  trackExternalLinkClick: vi.fn(),
  pathnameRef: { current: '/docs/langgraph/guides/streaming' },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../../lib/analytics/client', () => ({
  trackCtaClick,
  trackExternalLinkClick,
}));

describe('Docs mobile navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    trackCtaClick.mockClear();
    trackExternalLinkClick.mockClear();
    pathnameRef.current = '/docs/langgraph/guides/streaming';
  });

  it('mounts the docs control plane, search trigger included, on the library-neutral docs index', () => {
    pathnameRef.current = '/docs';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    // The docs index (`/docs`) is library-neutral and has no section or slug
    // segments in its URL. What matters here is that the drawer still mounts
    // its control plane content for that page and exposes the search
    // trigger, rather than rendering nothing or throwing on the empty path.
    // The trigger's click-to-dispatch behavior itself (drawer close, focus
    // restore, cmd+k dispatch) is the same handler on every route and is
    // already covered by 'closes the drawer before dispatching mobile
    // search' below — asserting it again here would just be that same test.
    expect(within(dialog).getByRole('button', { name: 'Search docs' })).toBeTruthy();
  });

  it('does not invent a library on a library-neutral docs page', () => {
    pathnameRef.current = '/docs/choosing-an-adapter';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    // `/docs/choosing-an-adapter` has no library segment. Falling back to
    // 'langgraph' made the Scope card read "LangGraph / Getting Started /
    // Documentation" — three fabrications in the one card whose job was
    // saying where you are. That card is gone now (Task 3); what remains
    // observable is that the drawer still does not fabricate a library
    // selection for a library-neutral page.
    expect(within(dialog).queryByRole('button', { name: 'LangGraph' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Choose a library' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Search docs' })).toBeTruthy();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const installDesktopMediaQuery = () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        media: '(min-width: 64rem)',
        onchange: null,
        addEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.add(listener),
        removeEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
    return () => {
      act(() => {
        for (const listener of listeners) {
          listener({ matches: true } as MediaQueryListEvent);
        }
      });
    };
  };

  const expectFocusAfterDrawerUnmount = (trigger: HTMLButtonElement) => {
    const nativeFocus = trigger.focus.bind(trigger);
    const observation = { drawerWasMounted: undefined as boolean | undefined };
    const focus = vi.spyOn(trigger, 'focus').mockImplementation(() => {
      observation.drawerWasMounted = Boolean(
        screen.queryByRole('dialog', { name: 'Mobile navigation' }),
      );
      nativeFocus();
    });
    return { focus, observation };
  };

  it('opens a panel per trigger and links each library from it', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    const navigation = screen.getByRole('navigation');

    const libraries = within(navigation).getByRole('button', { name: 'Libraries' });
    expect(libraries.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(libraries);
    expect(libraries.getAttribute('aria-expanded')).toBe('true');

    const panel = document.getElementById(
      libraries.getAttribute('aria-controls') ?? '',
    );
    if (!panel) throw new Error('Expected the trigger to control a panel');
    expect(
      within(panel).getByRole('link', { name: /@threadplane\/langgraph/ }).getAttribute('href'),
    ).toBe('/langgraph');
    expect(
      within(panel).getByRole('link', { name: /@threadplane\/render/ }).getAttribute('href'),
    ).toBe('/render');
    expect(
      within(panel).getByRole('link', { name: /Choosing an adapter/ }).getAttribute('href'),
    ).toBe('/docs/choosing-an-adapter');
  });

  it('keeps Pricing a plain link and retires the Demo dropdown', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    const navigation = screen.getByRole('navigation');

    expect(
      within(navigation).getByRole('link', { name: 'Pricing' }).getAttribute('href'),
    ).toBe('/pricing');
    expect(within(navigation).queryByRole('button', { name: /^Demo/ })).toBeNull();

    fireEvent.click(within(navigation).getByRole('button', { name: 'Docs' }));
    expect(
      screen.getByRole('link', { name: /LangGraph demo/ }).getAttribute('href'),
    ).toBe('https://demo.threadplane.ai');
    expect(
      screen.getByRole('link', { name: /AG-UI demo/ }).getAttribute('href'),
    ).toBe('https://ag-ui.threadplane.ai');
  });

  it('shows one panel at a time and closes on Escape, restoring trigger focus', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    const navigation = screen.getByRole('navigation');
    const libraries = within(navigation).getByRole('button', { name: 'Libraries' });
    const solutions = within(navigation).getByRole('button', { name: 'Solutions' });

    fireEvent.click(libraries);
    fireEvent.click(solutions);
    expect(libraries.getAttribute('aria-expanded')).toBe('false');
    expect(solutions.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(solutions.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(solutions);
  });

  it('tags panel link analytics with the trigger it came from', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    const navigation = screen.getByRole('navigation');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Solutions' }));
    fireEvent.click(screen.getByRole('link', { name: /Blog/ }));

    expect(trackCtaClick).toHaveBeenCalledWith({
      surface: 'nav',
      destination_url: '/blog',
      cta_id: 'nav_solutions_blog',
      cta_text: 'Blog',
    });
  });

  it('prefixes external panel link analytics with the surface too', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    const navigation = screen.getByRole('navigation');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Docs' }));
    fireEvent.click(within(navigation).getByRole('link', { name: /LangGraph demo/ }));

    expect(trackExternalLinkClick).toHaveBeenCalledWith('https://demo.threadplane.ai', {
      surface: 'nav',
      cta_id: 'nav_docs_demo_langgraph',
      cta_text: 'LangGraph demo',
    });
  });

  it('still links the repository from the bar', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    expect(
      within(screen.getByRole('navigation'))
        .getByRole('link', { name: 'GitHub repository' })
        .getAttribute('href'),
    ).toBe('https://github.com/cacheplane/threadplane');
  });

  it('opens pre-pushed to the docs tree on a docs route, with no tab strip', () => {
    pathnameRef.current = '/docs/langgraph/guides/streaming';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    expect(within(dialog).queryByRole('button', { name: 'Site' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Search docs' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Learn' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Back to menu' })).toBeTruthy();
  });

  it('opens at the root on a marketing route', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    expect(within(dialog).getByRole('button', { name: 'Libraries' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe(
      '/pricing',
    );
    expect(within(dialog).queryByRole('button', { name: 'Back to menu' })).toBeNull();
  });

  it('pushes a level and comes back', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Libraries' }));
    expect(
      within(dialog).getByRole('link', { name: /@threadplane\/chat/ }).getAttribute('href'),
    ).toBe('/chat');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to menu' }));
    expect(within(dialog).getByRole('button', { name: 'Libraries' })).toBeTruthy();
    expect(within(dialog).queryByRole('link', { name: /@threadplane\/chat/ })).toBeNull();
  });

  it('shows the footer lead above the Choosing-an-adapter link in the Libraries level', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Libraries' }));
    expect(within(dialog).getByText('Not sure which one?')).toBeTruthy();
    expect(
      within(dialog).getByRole('link', { name: /Choosing an adapter/ }).getAttribute('href'),
    ).toBe('/docs/choosing-an-adapter');
  });

  it('shows the marketing Docs panel off a docs route', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Docs' }));
    expect(
      within(dialog).getByRole('link', { name: /Quick start/ }).getAttribute('href'),
    ).toBe('/docs/langgraph/getting-started/quickstart');
    expect(within(dialog).queryByRole('button', { name: 'Learn' })).toBeNull();
  });

  it('Escape pops a level before it closes the drawer', async () => {
    pathnameRef.current = '/';
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Solutions' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Mobile navigation' })).toBeTruthy();
    // Scoped to the drawer: the desktop bar renders its own `Solutions`
    // trigger in jsdom, so the bare query matches two buttons and throws.
    expect(within(dialog).getByRole('button', { name: 'Solutions' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Awaited, not read straight after the unmount: the restore runs in the
    // frame after the drawer leaves the DOM, as the sibling close tests show.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('Escape closes from the drawer root reached by going back on a docs route', async () => {
    pathnameRef.current = '/docs/langgraph/guides/streaming';
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    // The drawer opened pre-pushed to the docs level; walking back reaches a
    // root the reader never pushed from. Escape must still dismiss there.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to menu' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('Escape still pops a level pushed from that root on a docs route', async () => {
    pathnameRef.current = '/docs/langgraph/guides/streaming';
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to menu' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Libraries' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('dialog', { name: 'Mobile navigation' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Libraries' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('moves focus into the level it just pushed', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Libraries' }));

    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Back to menu' }),
    );
  });

  it('returns focus to the trigger row a popped level came from', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    // Both pop paths, one after the other, against the same drawer: the
    // "Back to menu" button and Escape must land in the same place, and that
    // place is the row the reader pushed from — not whatever the focus trap's
    // query happens to list first. (jsdom's multi-clause querySelectorAll
    // groups by clause instead of returning document order, so an assertion
    // written against `focusable()[0]` would encode the wrong element and
    // pass while a real browser did something else.)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Libraries' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to menu' }));
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Libraries' }),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Libraries' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Libraries' }),
    );
  });

  it('tags mobile panel analytics with the trigger it came from', () => {
    pathnameRef.current = '/';
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Libraries' }));
    fireEvent.click(within(dialog).getByRole('link', { name: /@threadplane\/render/ }));

    expect(trackCtaClick).toHaveBeenCalledWith({
      surface: 'mobile_nav',
      destination_url: '/render',
      cta_id: 'mobile_nav_libraries_render',
      cta_text: '@threadplane/render',
    });
  });

  it('closes from the global control inside the dialog and restores trigger focus', async () => {
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const { focus, observation } = expectFocusAfterDrawerUnmount(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close menu' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(observation.drawerWasMounted).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape and restores focus to the sole trigger', async () => {
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const { focus, observation } = expectFocusAfterDrawerUnmount(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(observation.drawerWasMounted).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes after Docs link navigation and restores focus after unmount', async () => {
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const { focus, observation } = expectFocusAfterDrawerUnmount(trigger);

    const destination = within(screen.getByRole('dialog')).getByRole('link', {
      name: 'Persistence',
    });
    expect(destination.getAttribute('href')).toBe('/docs/langgraph/guides/persistence');
    fireEvent.click(destination);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(observation.drawerWasMounted).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes and unlocks the page at the desktop breakpoint without restoring mobile intent', async () => {
    const crossToDesktop = installDesktopMediaQuery();
    const searchListener = vi.fn();
    document.addEventListener('keydown', searchListener);
    render(
      <>
        <Nav />
        <div id="site-content"><button type="button">Page content</button></div>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    const focus = vi.spyOn(trigger, 'focus');
    const nav = document.querySelector<HTMLElement>('.nav-bar');
    const siteContent = document.getElementById('site-content');
    if (!nav || !siteContent) throw new Error('Expected modal background surfaces');

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Mobile navigation' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    expect(nav.inert).toBe(true);
    expect(siteContent.inert).toBe(true);

    crossToDesktop();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.overflow).toBe('');
    expect(nav.inert).toBe(false);
    expect(siteContent.inert).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(searchListener).not.toHaveBeenCalled();
    document.removeEventListener('keydown', searchListener);
  });

  it('cancels queued search and focus when the breakpoint changes after dismissal', () => {
    const crossToDesktop = installDesktopMediaQuery();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        nextFrame += 1;
        frames.set(nextFrame, callback);
        return nextFrame;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frame: number) => frames.delete(frame)),
    );
    const searchListener = vi.fn();
    document.addEventListener('keydown', searchListener);
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const focus = vi.spyOn(trigger, 'focus');

    fireEvent.click(screen.getByRole('button', { name: 'Search docs' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(frames.size).toBe(1);

    crossToDesktop();
    act(() => {
      for (const callback of frames.values()) callback(16);
    });

    expect(focus).not.toHaveBeenCalled();
    expect(searchListener).not.toHaveBeenCalled();
    document.removeEventListener('keydown', searchListener);
  });

  it('makes the top navigation and site content inert only while the drawer is open', async () => {
    render(
      <>
        <Nav />
        <div id="site-content"><button type="button">Page content</button></div>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    const nav = document.querySelector<HTMLElement>('.nav-bar');
    const siteContent = document.getElementById('site-content');
    if (!nav || !siteContent) throw new Error('Expected modal background surfaces');

    fireEvent.click(trigger);
    expect(nav.inert).toBe(true);
    expect(siteContent.inert).toBe(true);

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close menu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(nav.inert).toBe(false);
    expect(siteContent.inert).toBe(false);
  });

  it('keeps the drawer open when Escape dismisses the nested library menu', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });
    const libraryTrigger = within(dialog).getByRole('button', { name: 'LangGraph' });
    fireEvent.click(libraryTrigger);

    fireEvent.keyDown(within(dialog).getByRole('menuitemradio', { name: /LangGraph/ }), {
      key: 'Escape',
    });

    expect(screen.getByRole('dialog', { name: 'Mobile navigation' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(libraryTrigger);
  });

  it('closes the drawer before dispatching mobile search', async () => {
    const searchListener = vi.fn();
    document.addEventListener('keydown', searchListener);
    render(<Nav />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const { focus, observation } = expectFocusAfterDrawerUnmount(trigger);

    const searchObservation = {
      drawerWasMounted: undefined as boolean | undefined,
      focusedTrigger: undefined as boolean | undefined,
    };
    searchListener.mockImplementation(() => {
      searchObservation.drawerWasMounted = Boolean(
        screen.queryByRole('dialog', { name: 'Mobile navigation' }),
      );
      searchObservation.focusedTrigger = document.activeElement === trigger;
    });

    fireEvent.click(screen.getByRole('button', { name: 'Search docs' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mobile navigation' })).toBeNull());
    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(observation.drawerWasMounted).toBe(false);
    await waitFor(() => expect(searchListener).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k', metaKey: true }),
    ));
    expect(searchObservation).toEqual({ drawerWasMounted: false, focusedTrigger: true });
    document.removeEventListener('keydown', searchListener);
  });

  it('preserves page-level analytics for Docs links', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });
    fireEvent.click(within(dialog).getByRole('link', { name: 'Streaming' }));

    expect(trackCtaClick).toHaveBeenCalledWith({
      surface: 'mobile_nav',
      destination_url: '/docs/langgraph/guides/streaming',
      cta_id: 'mobile_nav_docs_page',
      cta_text: 'Streaming',
      library: 'langgraph',
    });
  });
});
