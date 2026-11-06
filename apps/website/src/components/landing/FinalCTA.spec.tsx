// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinalCTA } from './FinalCTA';

const trackCtaClickMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: trackCtaClickMock,
  trackExternalLinkClick: vi.fn(),
}));

beforeEach(() => trackCtaClickMock.mockClear());

describe('FinalCTA', () => {
  it('defaults to the tinted surface (used by 4 non-home pages)', () => {
    const { container } = render(<FinalCTA />);
    expect(
      container.querySelector('[data-ui="section"]')?.getAttribute('data-surface'),
    ).toBe('tinted');
  });

  it('renders the dark surface when variant="dark"', () => {
    const { container } = render(<FinalCTA variant="dark" />);
    const section = container.querySelector('[data-ui="section"]');
    expect(section?.getAttribute('data-surface')).toBe('dark');
    expect(container.querySelector('.final-cta-mark')).toBeTruthy();
    expect(container.querySelector('.final-cta-mark')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults its secondary action to the same-origin streaming workspace', () => {
    render(<FinalCTA />);

    const link = screen.getByRole('link', {
      name: 'See each feature in action →',
    });
    expect(link.getAttribute('href')).toBe(
      '/docs/angular/langgraph/guides/streaming?mode=run'
    );
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('rel')).toBeNull();
  });

  it('fires trackCtaClick with the given ctaId when the primary CTA is clicked', () => {
    render(
      <FinalCTA
        primary={{ label: 'Start the quickstart', href: '/docs/quickstart', ctaId: 'hero_quickstart' }}
      />,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Start the quickstart' }));
    expect(trackCtaClickMock).toHaveBeenCalledWith({
      cta_id: 'hero_quickstart',
      track: 'developer',
      surface: 'final_cta',
      destination_url: '/docs/quickstart',
    });
  });

  it('fires trackCtaClick with the given ctaId when the secondary CTA is clicked', () => {
    render(
      <FinalCTA
        primary={{ label: 'Start the quickstart', href: '/docs/quickstart' }}
        secondary={{ label: 'Run live examples', href: '/docs/run', ctaId: 'hero_live_demo' }}
      />,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Run live examples' }));
    expect(trackCtaClickMock).toHaveBeenCalledWith({
      cta_id: 'hero_live_demo',
      track: 'developer',
      surface: 'final_cta',
      destination_url: '/docs/run',
    });
  });

  it('does not fire tracking when a CTA has no ctaId', () => {
    render(<FinalCTA primary={{ label: 'Start the quickstart', href: '/docs/quickstart' }} />);
    fireEvent.click(screen.getByRole('link', { name: 'Start the quickstart' }));
    expect(trackCtaClickMock).not.toHaveBeenCalled();
  });

  it('joins caption and captionLink with " · "', () => {
    render(
      <FinalCTA
        primary={{ label: 'Start the quickstart', href: '/docs/quickstart' }}
        caption="MIT · no account, no cloud"
        captionLink={{ label: 'Talk to an engineer', href: '/contact' }}
      />,
    );
    const caption = screen.getByText(/MIT · no account, no cloud/);
    expect(caption.textContent).toBe('MIT · no account, no cloud · Talk to an engineer');
    expect(screen.getByRole('link', { name: 'Talk to an engineer' }).getAttribute('href')).toBe('/contact');
  });

  it('renders extra caption links after the first, separated by " · "', () => {
    render(
      <FinalCTA
        primary={{ label: 'Go', href: '/go' }}
        caption="MIT · no account, no cloud"
        captionLink={{ label: 'Talk to an engineer', href: '/contact' }}
        captionLinks={[{ label: 'Setup prompt for coding agents', href: '/docs/angular/chat/getting-started/coding-agents' }]}
      />,
    );
    expect(screen.getByText(/MIT · no account, no cloud/).textContent).toBe(
      'MIT · no account, no cloud · Talk to an engineer · Setup prompt for coding agents',
    );
    expect(screen.getByRole('link', { name: 'Setup prompt for coding agents' }).getAttribute('href')).toBe(
      '/docs/angular/chat/getting-started/coding-agents',
    );
  });

  it('does not lead with a separator when captionLinks is the only caption content', () => {
    const { container } = render(
      <FinalCTA
        primary={{ label: 'Go', href: '/go' }}
        captionLinks={[
          { label: 'A', href: '/a' },
          { label: 'B', href: '/b' },
        ]}
      />,
    );
    expect(container.querySelector('.final-cta-caption')?.textContent).toBe('A · B');
  });
});

describe('FinalCTA caption surface', () => {
  it('renders no trailing caption', () => {
    const { container } = render(<FinalCTA />);

    expect(container.querySelector('.final-cta-caption')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/installation is inert/i);
  });
});
