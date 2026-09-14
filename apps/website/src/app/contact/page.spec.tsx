// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const track = vi.hoisted(() => vi.fn());

vi.mock('../../lib/analytics/client', () => ({ track, trackCtaClick: vi.fn(), trackExternalLinkClick: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../components/contact/GitHubStarsPill', () => ({ GitHubStarsPill: () => <span data-testid="stars" /> }));

import ContactPage from './page';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContactPage', () => {
  it('renders the contact variant by default', async () => {
    render(await ContactPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Contact', { selector: '[data-ui="eyebrow"]' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Talk to an engineer.');
    expect(screen.getByRole('button', { name: 'Send to Brian' })).toBeTruthy();
    expect(screen.queryByLabelText('Timeline')).toBeNull();
    const email = screen.getByRole('link', { name: 'brian@threadplane.ai' });
    expect(email.getAttribute('href')).toBe('mailto:brian@threadplane.ai');
    const github = screen.getByRole('link', { name: 'GitHub issues' });
    expect(github.getAttribute('href')).toBe('https://github.com/cacheplane/threadplane/issues');
    const discord = screen.getByRole('link', { name: 'Discord' });
    expect(discord.getAttribute('href')).toBe('https://discord.gg/cacheplane');
    expect(screen.getByTestId('stars')).toBeTruthy();
  });

  it('renders the enterprise variant from the intent query and passes the entry point through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    render(await ContactPage({ searchParams: Promise.resolve({ intent: 'enterprise', entry: 'pricing_tier_enterprise' }) }));
    expect(screen.getByText('Enterprise', { selector: '[data-ui="eyebrow"]' })).toBeTruthy();
    expect(screen.getByLabelText('Timeline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request a conversation' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'buyer@example.com' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme Co' } });
    fireEvent.change(screen.getByLabelText('Timeline'), { target: { value: 'this_quarter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request a conversation' }));

    expect(track).toHaveBeenCalledWith(
      'marketing:lead_form_submit',
      expect.objectContaining({ surface: 'pricing', entry_point: 'pricing_tier_enterprise' })
    );
  });

  it('ignores unknown intents and unsafe entry values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    render(await ContactPage({ searchParams: Promise.resolve({ intent: 'weird', entry: '<script>' }) }));
    const button = screen.getByRole('button', { name: 'Send to Brian' });
    expect(button).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'buyer@example.com' } });
    fireEvent.click(button);

    expect(track).toHaveBeenCalledWith(
      'marketing:lead_form_submit',
      expect.not.objectContaining({ entry_point: expect.anything() })
    );
  });
});
