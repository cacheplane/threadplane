import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declarationsFor, loadStylesheet } from '../../styles/style-contract';
import { DocsTOC } from './DocsTOC';

const headings = [
  { id: 'first', text: 'First', level: 2 as const },
  { id: 'second', text: 'Second', level: 2 as const },
];

const rectAt = (top: number): DOMRect =>
  ({
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);

describe('DocsTOC', () => {
  let secondTop = 250;

  beforeEach(() => {
    secondTop = 250;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('docs-workspace-article'))
          return rectAt(80);
        if (this.id === 'first') return rectAt(100);
        if (this.id === 'second') return rectAt(secondTop);
        return rectAt(0);
      }
    );
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('docs-workspace-article') ? 400 : 0;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('tracks the reading line inside the nearest workspace article scroller', () => {
    const { container } = render(
      <div className="docs-workspace-article">
        <h2 id="first">First</h2>
        <h2 id="second">Second</h2>
        <DocsTOC headings={headings} />
      </div>
    );

    expect(
      screen.getByRole('link', { name: 'First' }).hasAttribute('data-active')
    ).toBe(true);
    secondTop = 160;
    act(() => {
      container.firstElementChild?.dispatchEvent(new Event('scroll'));
    });
    expect(
      screen.getByRole('link', { name: 'Second' }).hasAttribute('data-active')
    ).toBe(true);
  });

  it('falls back to window scrolling on legacy Docs pages', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 400,
    });
    secondTop = 250;
    render(
      <>
        <h2 id="first">First</h2>
        <h2 id="second">Second</h2>
        <DocsTOC headings={headings} />
      </>
    );

    expect(
      screen.getByRole('link', { name: 'First' }).hasAttribute('data-active')
    ).toBe(true);
    secondTop = 80;
    act(() => window.dispatchEvent(new Event('scroll')));
    expect(
      screen.getByRole('link', { name: 'Second' }).hasAttribute('data-active')
    ).toBe(true);
  });

  it('tracks headings that stream into the article after the rail hydrates', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { container } = render(
      <div className="docs-workspace-article">
        <article />
        <DocsTOC headings={headings} />
      </div>
    );
    expect(
      screen.getByRole('link', { name: 'First' }).hasAttribute('data-active')
    ).toBe(false);
    act(() => {
      container
        .querySelector('article')
        ?.insertAdjacentHTML(
          'beforeend',
          '<h2 id="first">First</h2><h2 id="second">Second</h2>'
        );
    });
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'First' }).hasAttribute('data-active')
      ).toBe(true)
    );
    secondTop = 160;
    act(() => container.firstElementChild?.dispatchEvent(new Event('scroll')));
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Second' }).hasAttribute('data-active')
      ).toBe(true)
    );
  });

  it('uses its panel scroller without applying the global nav offset twice', () => {
    const declarations = declarationsFor(
      loadStylesheet('docs.css'),
      '.docs-toc'
    );

    expect(declarations).toMatch(/top:\s*0/);
    expect(declarations).toMatch(/max-height:\s*100%/);
    expect(declarations).not.toContain('var(--nav-h)');
  });
});
