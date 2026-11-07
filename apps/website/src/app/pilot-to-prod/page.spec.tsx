import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import PilotToProdPage from './page';

vi.mock('../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: vi.fn(),
  trackExternalLinkClick: vi.fn(),
  trackWhitepaperDownloadClick: vi.fn(),
}));

describe('PilotToProdPage', () => {
  it('presents three scoped phases and the handoff outcomes', () => {
    const { container } = render(<PilotToProdPage />);
    expect(container.querySelectorAll('.pilot-phase')).toHaveLength(3);
    expect(container.querySelectorAll('.pilot-outcomes li')).toHaveLength(3);
    expect(container.querySelectorAll('[data-ui="eyebrow"]')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('routes discovery directly to the enterprise form and preserves production guidance', () => {
    render(<PilotToProdPage />);

    expect(
      screen
        .getByRole('link', { name: 'Request a discovery call' })
        .getAttribute('href')
    ).toBe('/contact?intent=enterprise&entry=pilot_to_prod');
    expect(
      screen
        .getByRole('link', { name: 'Explore production patterns' })
        .getAttribute('href')
    ).toBe('/docs/angular/langgraph/guides/deployment');
    expect(
      screen.getByText(/eight-week plan below is an example/)
    ).toBeTruthy();
  });
});
