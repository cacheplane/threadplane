// @vitest-environment jsdom
import React from 'react';
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
      '/docs/langgraph/api/inject-agent',
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

  it.each(['/', '/pricing', '/blog/some-post', '/docs-adjacent'])(
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
    '/docs/langgraph/guides/testing',
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

  it('hands the server-owned policy through to the footer newsletter form', () => {
    pathname.current = '/pricing';

    render(<SiteFooter formPolicy={formPolicy} />);

    const disclosure = screen.getByText(formPolicy.disclosures.newsletter);
    expect(
      screen
        .getByRole('button', { name: /subscribe/i })
        .getAttribute('aria-describedby')
    ).toBe(disclosure.id);
  });

  it('hides the newsletter form on the homepage, whose field report form is the one form', () => {
    pathname.current = '/';
    render(<SiteFooter formPolicy={formPolicy} />);
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
    expect(screen.queryByText(formPolicy.disclosures.newsletter)).toBeNull();
    expect(document.querySelector('footer')).not.toBeNull();
  });
});
