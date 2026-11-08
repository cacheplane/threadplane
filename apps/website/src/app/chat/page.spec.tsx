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
// Next renders highlighted code on the server; use a synchronous stand-in in jsdom.
vi.mock(
  '../../components/landing/chat-landing/ChatLandingCodeShowcase',
  () => ({ ChatLandingCodeShowcase: () => null })
);

describe('ChatPage', () => {
  it('keeps framework docs, media controls, and the gated report available', async () => {
    const { container } = render(await ChatPage());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'React docs' }).getAttribute('href')
    ).toBe('/docs/react/chat/guides/generative-ui');
    expect(
      screen.getByRole('link', { name: 'Angular docs' }).getAttribute('href')
    ).toBe('/docs/angular/chat/getting-started/introduction');
    expect(
      screen.getByText(
        /React guides cover the current source-build integration/
      )
    ).toBeTruthy();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Get the field report' })
    ).toBeTruthy();
    expect(container.querySelector('a[href$=".pdf"]')).toBeNull();
    expect(container.querySelector('[data-ui="eyebrow"]')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Code' })).toBeNull();
    const live = screen.getByRole('link', { name: 'See it live' });
    expect(live.getAttribute('href')).toBe(
      '/docs/angular/chat/guides/generative-ui?mode=run'
    );
    expect(live.getAttribute('target')).toBeNull();
  });
});
