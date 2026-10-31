import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocsDemoVideo } from './DocsDemoVideo';

afterEach(cleanup);

describe('DocsDemoVideo', () => {
  it('lets readers start and pause a captioned recording without automatic motion', () => {
    const { container } = render(
      <DocsDemoVideo demo="streaming" frontend="angular" />
    );
    const video = container.querySelector('video');
    if (!video) throw new Error('Expected a documentation recording');
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.loop).toBe(false);
    expect(video.preload).toBe('none');
    expect(video.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      container.querySelector('track[kind="captions"][srclang="en"]')
    ).not.toBeNull();
    expect(
      screen.getByText('Read the walkthrough').closest('details')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-docs-demo-provenance]')?.textContent
    ).toMatch(/fixture/i);
  });

  it('selects the requested framework without borrowing another recording', () => {
    const { container } = render(
      <DocsDemoVideo demo="persistence" frontend="react" />
    );
    expect(container.querySelector('source')?.getAttribute('src')).toContain(
      'persistence-react'
    );
    expect(
      screen.getByRole('link', { name: 'Capture details' }).getAttribute('href')
    ).toContain('persistence-react');
  });

  it('rejects unknown media rather than rendering a broken or unrelated recording', () => {
    expect(() =>
      render(<DocsDemoVideo demo={'missing' as 'streaming'} />)
    ).toThrow(/Unknown documentation recording/);
  });
});
