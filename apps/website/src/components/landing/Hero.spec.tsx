// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  HERO_EYEBROW,
  HERO_H1,
  HERO_SECONDARY_HREF,
} from '../../lib/positioning';

const trackMock = vi.hoisted(() => vi.fn());
const trackCtaClickMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/analytics/client', () => ({
  track: trackMock,
  trackCtaClick: trackCtaClickMock,
}));

// Stub design-system primitives — they don't import React (rely on Next's
// automatic JSX runtime) but the vitest transform here doesn't auto-inject.
// We're testing Hero's CTA wiring, not the wrappers.
vi.mock('../ui/Container', () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../ui/Section', () => ({
  Section: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../ui/Eyebrow', () => ({
  Eyebrow: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../ui/BrowserFrame', () => ({
  BrowserFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../ui/Button', () => ({
  Button: ({ children, href, onClick }: { children: React.ReactNode; href?: string; onClick?: () => void }) =>
    href ? (
      <a href={href} onClick={onClick}>{children}</a>
    ) : (
      <button onClick={onClick}>{children}</button>
    ),
}));
vi.mock('./HeroDemo', () => ({ HeroDemo: () => <div data-testid="hero-demo" /> }));
vi.mock('./InstallDialog', () => ({
  InstallDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Install Threadplane" /> : null),
}));

beforeEach(() => {
  trackMock.mockClear();
  trackCtaClickMock.mockClear();
});

describe('Hero', () => {
  it('keeps the hero focused on the headline and actions', async () => {
    const { Hero } = await import('./Hero');
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HERO_H1);
    expect(screen.queryByText(HERO_EYEBROW)).toBeNull();
    expect(document.querySelector('.hero-subhead')).toBeNull();
    expect(document.querySelector('.hero-chip-row')).toBeNull();
    expect(screen.queryByText(/six months/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Talk to our engineers/ })).toBeNull();
  });

  it('primary button opens the install dialog and fires hero_install_open', async () => {
    const { Hero } = await import('./Hero');
    render(<Hero />);
    fireEvent.click(screen.getByRole('button', { name: 'Install Threadplane' }));
    expect(screen.getByRole('dialog', { name: 'Install Threadplane' })).toBeTruthy();
    expect(trackCtaClickMock).toHaveBeenCalledWith(expect.objectContaining({ cta_id: 'hero_install_open', track: 'developer', surface: 'home' }));
  });

  it('secondary link goes to the docs run surface and fires hero_live_demo', async () => {
    const { Hero } = await import('./Hero');
    render(<Hero />);
    const link = screen.getByRole('link', { name: /See it running in the docs/ });
    expect(link.getAttribute('href')).toBe(HERO_SECONDARY_HREF);
    fireEvent.click(link);
    expect(trackCtaClickMock).toHaveBeenCalledWith(expect.objectContaining({ cta_id: 'hero_live_demo' }));
  });

  it('mounts the demo below the copy', async () => {
    const { Hero } = await import('./Hero');
    render(<Hero />);
    expect(screen.getByTestId('hero-demo')).toBeTruthy();
  });

  it('offers both framework quickstarts without release-status copy', async () => {
    const { Hero } = await import('./Hero');
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The open source (and free) threadplane for agents');
    expect(screen.getByRole('link', { name: 'Angular quickstart' }).getAttribute('href')).toBe('/docs/langgraph/getting-started/quickstart');
    expect(screen.getByRole('link', { name: 'React quickstart' }).getAttribute('href')).toBe('/docs/react/getting-started/quickstart');
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'LangGraph integration' }).getAttribute('href')).toBe('/langgraph');
    expect(screen.getByRole('link', { name: 'AG-UI integration' }).getAttribute('href')).toBe('/ag-ui');
  });
});
