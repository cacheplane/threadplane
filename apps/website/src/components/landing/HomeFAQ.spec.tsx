// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HomeFAQ } from './HomeFAQ';

describe('HomeFAQ', () => {
  it('asks only what the page above did not answer', () => {
    const { container } = render(<HomeFAQ />);
    const questions = [
      'Is Threadplane a backend agent framework?',
      'Can I use my existing component library and design system?',
      'Does generated UI execute arbitrary code?',
      'Does Threadplane require a hosted service or an account?',
      'Does Threadplane have a runtime I need to deploy?',
    ];
    for (const q of questions) expect(screen.getByText(q)).toBeTruthy();
    expect(screen.queryByText('Does Threadplane require LangGraph?')).toBeNull();
    expect(screen.queryByText(/raw streaming SDK/)).toBeNull();
    expect(container.querySelectorAll('summary')).toHaveLength(5);
    expect(container.querySelectorAll('a')).toHaveLength(5);
  });

  it('answers the runtime question in the band’s own words', () => {
    render(<HomeFAQ />);
    const answer = screen.getByText(/no Threadplane server in the request path/);
    expect(answer.textContent).toMatch(/no key/);
    expect(answer.textContent).toMatch(/no production tier/);
    expect(answer.textContent).not.toMatch(/proxy/i);
    expect(answer.querySelector('a')?.getAttribute('href')).toBe('/docs/choosing-an-adapter');
  });
});
