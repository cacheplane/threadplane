// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AboutPage from './page';
import { getAuthor } from '../../lib/blog-authors';
import { ABOUT_PARAGRAPHS } from '../../lib/about-content';

vi.mock('../../components/ui/Container', () => ({
  Container: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('../../components/ui/Section', () => ({
  Section: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock('../../components/ui/Eyebrow', () => ({
  Eyebrow: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

const author = getAuthor('brian');

/**
 * This page is an E-E-A-T signal, so its visible prose is exactly the surface a
 * fabricated credential would appear on. These assertions tie the rendered
 * claims back to the author record rather than restating the layout.
 */
describe('AboutPage', () => {
  it('renders each sourced paragraph verbatim', () => {
    render(<AboutPage />);
    // Not substring matches: editorial embellishment around a sourced sentence
    // would still be a claim nothing citable supports.
    for (const paragraph of ABOUT_PARAGRAPHS) {
      expect(screen.getByText(paragraph).textContent).toBe(paragraph);
    }
  });

  it('adds no biographical prose beyond the sourced paragraphs', () => {
    // The real guard. Every claim on this page has to trace to about-content.ts,
    // whose provenance comment names the source; a paragraph appearing here that
    // is not in that module is exactly the fabrication this page must not carry.
    const { container } = render(<AboutPage />);
    const sourced = new Set<string>(ABOUT_PARAGRAPHS);

    const biography = container.querySelector('[data-about-biography]');
    expect(biography).not.toBeNull();
    const paragraphs = Array.from(biography?.querySelectorAll('p') ?? [])
      .map((node) => node.textContent ?? '')
      .filter((text) => text.split(' ').length > 12);

    expect(paragraphs.length).toBe(ABOUT_PARAGRAPHS.length);
    for (const text of paragraphs) {
      expect(sourced.has(text), text).toBe(true);
    }
  });

  it('names the author the record gives', () => {
    render(<AboutPage />);
    expect(screen.getByText(ABOUT_PARAGRAPHS[0]).textContent).toContain(
      author.name
    );
  });

  it('links the GitHub profile the record names', () => {
    render(<AboutPage />);
    expect(
      screen
        .getByRole('link', { name: `github.com/${author.github}` })
        .getAttribute('href')
    ).toBe(`https://github.com/${author.github}`);
  });

  it('references no image asset', () => {
    // There is no headshot in the repo. A later `<img>` here would either point
    // at a missing file or assert a likeness the project does not have.
    const { container } = render(<AboutPage />);
    expect(container.querySelectorAll('img').length).toBe(0);
  });
});
