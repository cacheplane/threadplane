import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import ChatPage from './page';

vi.mock('../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: vi.fn(),
  trackExternalLinkClick: vi.fn(),
  trackWhitepaperDownloadClick: vi.fn(),
}));

// The second FeatureBlock's showcase is an async Server Component (it awaits
// shiki highlighting via HighlightedCode). react-dom/client cannot render an
// async component at all outside Next's RSC pipeline ("Only Server
// Components can be async at the moment") — stand in a sync placeholder so
// the rest of the page (untouched by this task) can render in this harness.
vi.mock('../../components/landing/chat-landing/ChatLandingCodeShowcase', () => ({
  ChatLandingCodeShowcase: () => null,
}));

describe('ChatPage', () => {
  it('renders the package kicker, marker sweep, switcher, and dark closer', async () => {
    const ui = await ChatPage();
    const { container } = render(ui);
    expect(screen.getByText('@threadplane/chat · chat compositions')).toBeTruthy();
    expect(container.querySelector('.marker-highlight')?.textContent).toBe('Production-shaped from day one');
    expect(screen.getAllByRole('tablist').length).toBeGreaterThanOrEqual(1);
    const cta = [...container.querySelectorAll('[data-ui="section"]')].find((s) =>
      s.querySelector('.final-cta-inner'),
    );
    expect(cta?.getAttribute('data-surface')).toBe('dark');
  });

  it('opens generative UI in the same-origin Website workspace', async () => {
    const ui = await ChatPage();
    render(ui);

    const link = screen.getByRole('link', { name: 'See it live →' });
    expect(link.getAttribute('href')).toBe(
      '/docs/angular/chat/guides/generative-ui?mode=run'
    );
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('rel')).toBeNull();
  });
});
