// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TeamsBlock } from './TeamsBlock';
import { FIELD_REPORT } from '../../lib/field-report';
import type { PublicFormPolicy } from '../../lib/growth/form-policy';

vi.mock('../../lib/analytics/client', () => ({
  track: vi.fn(),
  trackCtaClick: vi.fn(),
  trackWhitepaperDownloadClick: vi.fn(),
}));

const formPolicy: PublicFormPolicy = {
  mode: 'growth_v1',
  version: 'growth_v1.2026-09-09',
  disclosures: { whitepaper: 'Whitepaper disclosure', newsletter: 'Newsletter disclosure', contact: 'Contact disclosure' },
};

describe('TeamsBlock', () => {
  it('leads with the report heading and keeps the form disclosure', () => {
    const { container } = render(<TeamsBlock formPolicy={formPolicy} />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Free preflight briefing for agentic UI');
    expect(heading.id).toBe('field-report-heading');
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(screen.getByLabelText('Work email')).toBeTruthy();
    expect(screen.getByText(formPolicy.disclosures.whitepaper)).toBeTruthy();
  });

  it('derives the page count rather than typing it', () => {
    // The section claimed "18 pages" for a 17-page document. Reading it from
    // FIELD_REPORT means the guard against the PDF covers this string too.
    const { container } = render(<TeamsBlock formPolicy={formPolicy} />);
    const description = container.querySelector('.home-report-description');
    expect(description?.textContent).toContain(`${FIELD_REPORT.pages}-page`);
    expect(description?.textContent).toContain('What breaks between a demo and production');
  });

  it('shows the briefing beside the ask', () => {
    const { container } = render(<TeamsBlock formPolicy={formPolicy} />);
    expect(container.querySelector('.field-report-paper')).toBeTruthy();
  });

  it('makes contact the secondary ask, not a rival button', () => {
    // Two same-weight buttons is what stopped the old section saying which
    // ask mattered. The arrow is decorative so the accessible name stays clean.
    const { container } = render(<TeamsBlock formPolicy={formPolicy} />);
    const link = screen.getByRole('link', { name: 'Talk to an engineer' });
    expect(link.getAttribute('href')).toBe('/contact?source=home_enterprise&track=enterprise');
    expect(link.getAttribute('data-ui')).not.toBe('button');
    // Exactly one button in the whole section, and it belongs to the form.
    // (SubmitButton wraps Button, so the form's submit carries data-ui too.)
    const buttons = container.querySelectorAll('[data-ui="button"]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('form')).toBeTruthy();
  });

  it('no longer repeats the pilot programme the dedicated page owns', () => {
    const { container } = render(<TeamsBlock formPolicy={formPolicy} />);
    expect(container.querySelectorAll('.pilot-step')).toHaveLength(0);
    expect(container.querySelectorAll('.pilot-row')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'See the pilot program' })).toBeNull();
  });

  it('never advertises topics the document does not contain', () => {
    // "Error boundaries", "fallbacks" and "observability" each return zero
    // matches in whitepaper.pdf. They were on this page for months.
    const { container } = render(<TeamsBlock formPolicy={formPolicy} />);
    const text = container.textContent ?? '';
    for (const phrase of ['Error boundaries', 'fallbacks', 'observability', '18 pages']) {
      expect(text).not.toContain(phrase);
    }
  });
});
