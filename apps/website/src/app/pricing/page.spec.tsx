// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import PricingPage, { metadata } from './page';
import { trackCtaClick } from '../../lib/analytics/client';

vi.mock('../../components/pricing/EnterpriseCtaBand', () => ({ EnterpriseCtaBand: () => null }));
vi.mock('../../lib/analytics/client', () => ({ trackCtaClick: vi.fn() }));

describe('PricingPage', () => {
  it('answers the software and hosting questions above the comparison', () => {
    render(<PricingPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Made you look!' })).toBeTruthy();
    expect(screen.getByText(/Every package is MIT/i)).toBeTruthy();
    expect(screen.getByText(/commercial products, internal tools, and client work/i)).toBeTruthy();
    expect(screen.getByText(/No Threadplane cloud/i)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Steal our source code.' })).toBeTruthy();
    expect(screen.getByText(/does not host your agents or conversations/i)).toBeTruthy();
    expect(screen.getByText(/durable persistence.*connected backend/i)).toBeTruthy();
  });

  it('sells three scoped services and links to the team and its products', () => {
    render(<PricingPage />);
    for (const name of ['Production Assurance', 'Pilot-to-Prod', 'Agent builds & integrations']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: /Explore b4.run/i }).getAttribute('href')).toBe('https://b4.run/');
    expect(screen.getByRole('link', { name: /Meet LiveLoveApp/i }).getAttribute('href')).toBe('https://liveloveapp.com/');
    expect(screen.getByRole('link', { name: 'Discuss assurance' }).getAttribute('href')).toContain('intent=enterprise');
    expect(screen.getByRole('link', { name: 'Plan a launch' }).getAttribute('href')).toContain('intent=enterprise');
    expect(screen.getByRole('link', { name: 'Build with us' }).getAttribute('href')).toContain('intent=enterprise');
  });

  it('renders one grouped comparison with semantic row and column headers', () => {
    const { container } = render(<PricingPage />);

    expect(screen.getByRole('table', { name: /Full plan comparison/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Community' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Production Assurance' })).toBeTruthy();
    expect(screen.queryByRole('rowheader', { name: 'MIT-licensed software' })).toBeNull();
    expect(screen.getByRole('rowheader', { name: 'Private support channel' })).toBeTruthy();
    expect(screen.getByText(/identical on every path/i)).toBeTruthy();
    expect(container.querySelectorAll('table[aria-label="Full plan comparison"]')).toHaveLength(1);
  });

  it('preserves source and services analytics when visitors choose a path', () => {
    render(<PricingPage />);
    for (const [label, ctaId] of [
      ['Take the code', 'pricing_tier_community'],
      ['Discuss assurance', 'pricing_tier_production_assurance'],
      ['Plan a launch', 'pricing_tier_enterprise'],
      ['Build with us', 'pricing_tier_enterprise'],
    ]) {
      const link = screen.getByRole('link', { name: label });
      // Exercise tracking without attempting browser navigation in jsdom.
      link.addEventListener('click', (event) => event.preventDefault());
      fireEvent.click(link);
      expect(trackCtaClick).toHaveBeenLastCalledWith({
        surface: 'pricing', cta_id: ctaId, cta_text: label,
        destination_url: link.getAttribute('href'),
      });
    }
  });

  it('does not present hosted-product quotas or bundled infrastructure', () => {
    const { container } = render(<PricingPage />);
    const text = container.textContent?.toLowerCase() ?? '';

    for (const prohibited of [
      'max threads',
      'hosted storage',
      'cloud hosting included',
      'channels credits',
      'model credits',
    ]) {
      expect(text).not.toContain(prohibited);
    }
  });

  it('uses MIT and services-accurate search metadata', () => {
    const description = String(metadata.description);
    expect(description).toContain('Every Threadplane package is MIT-licensed');
    expect(description).toContain('Production Assurance');
    expect(description).not.toContain('$29');
    expect(description).toContain('your own stack');
  });
});
