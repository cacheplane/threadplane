// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const trackCtaClick = vi.hoisted(() => vi.fn());
vi.mock('../../lib/analytics/client', () => ({ trackCtaClick }));

import { EnterpriseCtaBand } from './EnterpriseCtaBand';

describe('EnterpriseCtaBand', () => {
  it('links to the enterprise contact intent with its entry point', () => {
    render(<EnterpriseCtaBand />);
    const link = screen.getByRole('link', { name: 'Request a conversation' });
    expect(link.getAttribute('href')).toBe('/contact?intent=enterprise&entry=pricing_enterprise_band');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Good at code.');
  });
});
