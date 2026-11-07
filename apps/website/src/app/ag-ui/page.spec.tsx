import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import AgUiPage from './page';
vi.mock('../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: vi.fn(),
  trackExternalLinkClick: vi.fn(),
  trackWhitepaperDownloadClick: vi.fn(),
}));
// Next renders highlighted code on the server; use a synchronous stand-in in jsdom.

describe('AgUiPage', () => {
  it('keeps framework docs, media controls, and the gated report available', async () => {
    const { container } = render(await AgUiPage());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'React docs' }).getAttribute('href')
    ).toBe('/docs/react/ag-ui/guides/interrupts');
    expect(
      screen.getByRole('link', { name: 'Angular docs' }).getAttribute('href')
    ).toBe('/docs/angular/ag-ui/getting-started/quickstart');
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
    expect(screen.queryByRole('tab', { name: 'Live' })).toBeNull();
    expect(
      screen.getByText(/Thread history and checkpoints depend on your backend/)
    ).toBeTruthy();
  });
});
