// @vitest-environment jsdom
import React, { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

vi.mock('../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: vi.fn(),
  trackExternalLinkClick: vi.fn(),
}));

import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import { SiteFooter } from './SiteFooter';

const formPolicy: PublicFormPolicy = {
  mode: 'growth_v1',
  version: 'growth_v1.2026-09-01',
  disclosures: {
    contact: 'Contact disclosure',
    newsletter: 'Newsletter disclosure',
    whitepaper: 'Whitepaper disclosure',
  },
};

afterEach(() => {
  pathname.current = '/';
});

/**
 * The footer is mounted once, in the root layout, so it is the docs shell's
 * only way to opt out of it. These cases are the contract that opt-out obeys.
 */
describe('SiteFooter', () => {
  it('retires Examples without changing the active footer destinations or demos', () => {
    pathname.current = '/';

    render(<SiteFooter formPolicy={formPolicy} />);

    expect(screen.queryByRole('link', { name: 'Examples' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Documentation' }).getAttribute('href'),
    ).toBe('/docs');
    expect(
      screen.getByRole('link', { name: 'API Reference' }).getAttribute('href'),
    ).toBe(
      '/docs/api',
    );
    expect(
      screen.getByRole('link', { name: 'LangGraph demo' }).getAttribute('href'),
    ).toBe(
      'https://demo.threadplane.ai',
    );
    expect(
      screen.getByRole('link', { name: 'AG-UI demo' }).getAttribute('href'),
    ).toBe(
      'https://ag-ui.threadplane.ai',
    );
    expect(
      screen.getByRole('link', { name: 'Pilot to Prod' }).getAttribute('href'),
    ).toBe(
      '/pilot-to-prod',
    );
    expect(
      screen
        .getAllByRole('link', { name: 'Pricing' })
        .every((link) => link.getAttribute('href') === '/pricing'),
    ).toBe(true);
    expect(
      screen
        .getAllByRole('link', { name: 'GitHub' })
        .every(
          (link) =>
            link.getAttribute('href') ===
            'https://github.com/cacheplane/threadplane',
        ),
    ).toBe(true);
  });

  it.each(['/', '/index', '/pricing', '/blog/some-post', '/docs-adjacent'])(
    'renders the marketing footer on %s',
    (route) => {
      pathname.current = route;

      const { container } = render(<SiteFooter formPolicy={formPolicy} />);

      expect(container.querySelector('footer')).toBeTruthy();
    }
  );

  it.each([
    '/docs',
    '/docs/choosing-an-adapter',
    '/docs/angular/langgraph/guides/testing',
  ])(
    'suppresses it on %s so the docs stay a single sidebar pane',
    (route) => {
      pathname.current = route;

      const { container } = render(<SiteFooter formPolicy={formPolicy} />);

      expect(container.querySelector('footer')).toBeNull();
      expect(
        screen.queryByText(formPolicy.disclosures.newsletter)
      ).toBeNull();
    }
  );

  it.each(['/pricing', '/index-adjacent', '/index/other'])(
    'hands the server-owned policy through to the footer newsletter form on %s',
    (route) => {
      pathname.current = route;

      render(<SiteFooter formPolicy={formPolicy} />);

      const disclosure = screen.getByText(formPolicy.disclosures.newsletter);
      expect(
        screen
          .getByRole('button', { name: /subscribe/i })
          .getAttribute('aria-describedby')
      ).toBe(disclosure.id);
    }
  );

  it.each(['/', '/index'])(
    'hides the newsletter form on homepage alias %s, whose field report form is the one form',
    (route) => {
      pathname.current = route;
      render(<SiteFooter formPolicy={formPolicy} />);
      expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
      expect(screen.queryByText(formPolicy.disclosures.newsletter)).toBeNull();
      expect(document.querySelector('footer')).not.toBeNull();
    }
  );

  it('hydrates the internal /index homepage as public / without a markup mismatch', async () => {
    pathname.current = '/index';
    const container = document.createElement('div');
    container.innerHTML = renderToString(<SiteFooter formPolicy={formPolicy} />);
    document.body.appendChild(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    try {
      pathname.current = '/';
      await act(async () => {
        root = hydrateRoot(container, <SiteFooter formPolicy={formPolicy} />, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
      });

      expect(recoverableErrors).toEqual([]);
      expect(container.querySelector('footer')).not.toBeNull();
      expect(container.querySelector('.footer-signup')).toBeNull();
      expect(container.textContent).not.toContain(formPolicy.disclosures.newsletter);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
