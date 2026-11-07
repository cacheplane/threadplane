import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import SolutionPage from './page';
import { getAllSolutionSlugs } from '../../../lib/solutions-data';

vi.mock('../../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: vi.fn(),
  trackExternalLinkClick: vi.fn(),
}));

vi.mock('../../../components/solutions/SolutionCodeBlock', () => ({
  SolutionCodeBlock: () => null,
}));

vi.mock('../../../components/solutions/SolutionDemoBlock', () => ({
  SolutionDemoBlock: () => null,
}));

describe('SolutionPage', () => {
  it('uses the shared editorial layout and preserves routes to implementation and services', async () => {
    const slug = getAllSolutionSlugs()[0];
    const ui = await SolutionPage({ params: Promise.resolve({ slug }) });
    const { container } = render(ui);
    expect(container.querySelectorAll('[data-accent-text]')).toHaveLength(0);
    expect(container.querySelectorAll('[style*="--accent"]')).toHaveLength(0);
    expect(container.querySelector('.solutions-page')).toBeTruthy();
    expect(container.querySelectorAll('.solutions-capabilities li')).toHaveLength(3);
    expect(container.querySelectorAll('.solutions-libraries a')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Explore the code' }).getAttribute('href')).toBe('#solution-code-heading');
    expect(screen.getByRole('link', { name: 'Explore our services' }).getAttribute('href')).toBe('/pricing#services');
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
});
