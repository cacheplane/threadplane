import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MarkdownHtmlComponent } from './markdown-html.component';
import type {
  MarkdownHtmlBlockNode,
  MarkdownHtmlInlineNode,
} from '@cacheplane/partial-markdown';

function render(node: MarkdownHtmlBlockNode | MarkdownHtmlInlineNode): HTMLElement {
  const fixture = TestBed.createComponent(MarkdownHtmlComponent);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('MarkdownHtmlComponent', () => {
  it('renders a raw <script> html-block as escaped literal text (XSS-safe)', () => {
    const el = render({
      type: 'html-block',
      raw: "<script>alert('xss')</script>",
      htmlKind: 1,
    } as MarkdownHtmlBlockNode);
    // Shown as literal text...
    expect(el.textContent).toContain("<script>alert('xss')</script>");
    // ...and NOT injected as a real element.
    expect(el.querySelector('script')).toBeNull();
  });

  it('renders raw inline html as escaped text', () => {
    const el = render({
      type: 'html-inline',
      raw: '<b>not bold</b>',
    } as MarkdownHtmlInlineNode);
    expect(el.textContent).toContain('<b>not bold</b>');
    expect(el.querySelector('b')).toBeNull();
  });
});
