import { describe, it, expect, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MarkdownMathComponent } from './markdown-math.component';
import { loadKatex } from '../katex-loader';
import type {
  MarkdownMathInlineNode,
  MarkdownMathDisplayNode,
} from '@cacheplane/partial-markdown';

const inline = (text: string): MarkdownMathInlineNode =>
  ({ type: 'math-inline', text, delimiter: '$' }) as MarkdownMathInlineNode;
const display = (text: string): MarkdownMathDisplayNode =>
  ({ type: 'math-display', text, delimiter: '$$' }) as MarkdownMathDisplayNode;

function render(node: MarkdownMathInlineNode | MarkdownMathDisplayNode): HTMLElement {
  const fixture = TestBed.createComponent(MarkdownMathComponent);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('MarkdownMathComponent', () => {
  beforeAll(async () => {
    await loadKatex();
  });

  it('renders inline math as KaTeX', () => {
    const el = render(inline('x^2'));
    expect(el.querySelector('.katex')).toBeTruthy();
    expect(el.textContent).not.toContain('$');
  });

  it('renders display math as KaTeX display', () => {
    const el = render(display('\\sum_{i=0}^n i'));
    expect(el.querySelector('.katex-display')).toBeTruthy();
  });

  it('falls back to raw source (with delimiters) for invalid LaTeX', () => {
    const el = render(inline('\\frac{'));
    expect(el.querySelector('.katex')).toBeFalsy();
    expect(el.textContent).toContain('$\\frac{$');
  });
});
