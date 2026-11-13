import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdown } from '@threadplane/content/markdown';
import { Markdown } from './index.js';

afterEach(cleanup);

const source =
  'Inline $x^2$ and \\(y\\) here.\n\n$$\na+b\n$$\n\n\\[c\\]\n';
const snapshot = (content: string, phase: 'streaming' | 'complete' = 'complete') =>
  createMarkdown({ generation: 'a', phase, content }).getSnapshot();
const typeset = (latex: string, { display }: { readonly display: boolean }) =>
  `<b data-display="${display}">${latex.trim()}</b>`;

describe('Markdown math', () => {
  it('shows the delimited source when no renderer is given', () => {
    const view = render(<Markdown snapshot={snapshot(source)} />);
    expect(view.container.querySelector('.tp-markdown__math')).toBeNull();
    expect(view.container.textContent).toContain('$x^2$');
    expect(view.container.textContent).toContain('\\(y\\)');
    expect(view.container.textContent).toContain('$$\na+b\n$$');
    expect(view.container.textContent).toContain('\\[c\\]');
  });

  it('places the renderer output for inline and display math, with the LaTeX between the delimiters', () => {
    const math = vi.fn(typeset);
    const view = render(<Markdown snapshot={snapshot(source)} math={math} />);
    expect(
      math.mock.calls.map(([latex, options]) => [latex.trim(), options])
    ).toEqual([
      ['x^2', { display: false }],
      ['y', { display: false }],
      ['a+b', { display: true }],
      ['c', { display: true }],
    ]);
    const inline = view.container.querySelectorAll(
      'p span.tp-markdown__math:not(.tp-markdown__math--display)'
    );
    expect(Array.from(inline, (node) => node.innerHTML)).toEqual([
      '<b data-display="false">x^2</b>',
      '<b data-display="false">y</b>',
    ]);
    const display = view.container.querySelectorAll<HTMLElement>(
      'div.tp-markdown__math--display'
    );
    expect(Array.from(display, (node) => node.innerHTML)).toEqual([
      '<b data-display="true">a+b</b>',
      '<b data-display="true">c</b>',
    ]);
    expect(display[0].style.overflowX).toBe('auto');
    expect(display[0].closest('p')).toBeNull();
    expect(view.container.textContent).not.toContain('$');
    expect(view.container.textContent).toContain('Inline x^2 and y here.');
  });

  it('falls back to the source, per formula, when the renderer throws or returns nothing', () => {
    const math = (latex: string, options: { readonly display: boolean }) => {
      if (latex.includes('x^2')) throw new Error('bad LaTeX');
      if (latex.includes('a+b')) return null;
      if (latex.includes('c')) return '';
      return typeset(latex, options);
    };
    const view = render(<Markdown snapshot={snapshot(source)} math={math} />);
    expect(view.container.textContent).toContain('$x^2$');
    expect(view.container.textContent).toContain('$$\na+b\n$$');
    expect(view.container.textContent).toContain('\\[c\\]');
    const set = view.container.querySelectorAll('.tp-markdown__math');
    expect(Array.from(set, (node) => node.textContent)).toEqual(['y']);
  });

  it('typesets a formula once while the text around it streams, and again when the renderer changes', () => {
    const math = vi.fn(typeset);
    const view = render(
      <Markdown snapshot={snapshot('Sum $a$ is', 'streaming')} math={math} />
    );
    expect(math).toHaveBeenCalledTimes(1);
    view.rerender(
      <Markdown snapshot={snapshot('Sum $a$ is', 'streaming')} math={math} />
    );
    view.rerender(
      <Markdown snapshot={snapshot('Sum $a$ is small', 'streaming')} math={math} />
    );
    expect(math).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe('Sum a is small');
    const next = vi.fn(() => '<i>A</i>');
    view.rerender(
      <Markdown snapshot={snapshot('Sum $a$ is small', 'streaming')} math={next} />
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('.tp-markdown__math')?.innerHTML).toBe(
      '<i>A</i>'
    );
  });

  it('leaves math inside code alone', () => {
    const math = vi.fn(typeset);
    const view = render(
      <Markdown snapshot={snapshot('`$x$`\n\n```\n$$y$$\n```\n')} math={math} />
    );
    expect(math).not.toHaveBeenCalled();
    expect(view.container.querySelector('.tp-markdown__math')).toBeNull();
  });
});
