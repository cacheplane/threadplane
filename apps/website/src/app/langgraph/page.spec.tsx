import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import LangGraphPage from './page';
vi.mock('../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: vi.fn(),
  trackExternalLinkClick: vi.fn(),
  trackWhitepaperDownloadClick: vi.fn(),
}));
// Next renders highlighted code on the server; use a synchronous stand-in in jsdom.
vi.mock('../../components/landing/langgraph/LangGraphCodeShowcase', () => ({
  LangGraphCodeShowcase: () => null,
}));

describe('LangGraphPage', () => {
  it('keeps framework docs, media controls, and the gated report available', async () => {
    const { container } = render(await LangGraphPage());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'React docs' }).getAttribute('href')
    ).toBe('/docs/react/langgraph/guides/streaming');
    expect(
      screen.getByRole('link', { name: 'Angular docs' }).getAttribute('href')
    ).toBe('/docs/angular/langgraph/getting-started/introduction');
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
  });
});
