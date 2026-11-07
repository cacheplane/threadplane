// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocsLandingPage from './page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs',
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe('docs index', () => {
  it('keeps install-copy controls outside navigation links', () => {
    render(<DocsLandingPage />);
    for (const summary of screen.getAllByText('Angular install command'))
      fireEvent.click(summary);
    const buttons = screen.getAllByRole('button', {
      name: 'Copy install command',
    });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.closest('a')).toBeNull();
  });

  it('wears the same control plane as every other docs route', () => {
    render(<DocsLandingPage />);

    expect(screen.queryByRole('heading', { name: 'Scope' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search docs' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Choose a library' })
    ).toBeTruthy();
  });

  it('keeps the landing content out of the prose measure', () => {
    const { container } = render(<DocsLandingPage />);

    // The card grids need their own width; the [slug] route's md:max-w-3xl
    // article measure would flatten them into a single column.
    const body = container.querySelector('.docs-index-body');
    expect(body).toBeTruthy();
    expect(body?.className).not.toContain('max-w-3xl');
  });

  it('calls the render library what the docs call it', () => {
    render(<DocsLandingPage />);

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

  it('wires Run to the complete example directory', () => {
    render(<DocsLandingPage />);

    expect(screen.getByRole('link', { name: 'Run' }).getAttribute('href')).toBe(
      '/docs/examples'
    );
  });
});
