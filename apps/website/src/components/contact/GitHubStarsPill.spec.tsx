// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../lib/github', () => ({
  getGitHubStars: vi.fn(),
}));
vi.mock('../ui/Pill', () => ({
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { getGitHubStars } from '../../lib/github';
import { GitHubStarsPill } from './GitHubStarsPill';

describe('GitHubStarsPill', () => {
  it('renders with star count when fetch succeeds', async () => {
    (getGitHubStars as ReturnType<typeof vi.fn>).mockResolvedValue(1234);
    const el = await GitHubStarsPill();
    const { container } = render(el);
    expect(container.textContent).toMatch(/1,234/);
    expect(container.querySelector('a')?.getAttribute('href'))
      .toBe('https://github.com/cacheplane/threadplane');
  });

  it('renders fallback when fetch returns null', async () => {
    (getGitHubStars as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const el = await GitHubStarsPill();
    const { container } = render(el);
    expect(container.textContent).toMatch(/GitHub/);
    expect(container.textContent).not.toMatch(/\d/);
  });
});
