// libs/angular/chat/src/lib/markdown/views/markdown-math.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type {
  MarkdownMathInlineNode,
  MarkdownMathDisplayNode,
} from '@cacheplane/partial-markdown';
import { ChatMathRenderer } from '../katex-loader';

type MathNode = MarkdownMathInlineNode | MarkdownMathDisplayNode;

/** Opener/closer source text per delimiter, used for the raw fallback. */
const DELIMITERS: Record<MathNode['delimiter'], readonly [string, string]> = {
  $: ['$', '$'],
  '$$': ['$$', '$$'],
  '\\(\\)': ['\\(', '\\)'],
  '\\[\\]': ['\\[', '\\]'],
};

/**
 * Renders a `math-inline` / `math-display` markdown node as KaTeX, when the
 * application provides it with `provideChatMath()`. Without it, until KaTeX
 * loads, or if the LaTeX is invalid, the raw `$…$` source is shown — never
 * blank, never a crash.
 */
@Component({
  selector: 'chat-md-math',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (html(); as h) {
      <span
        class="chat-md-math"
        [class.chat-md-math--display]="display()"
        [innerHTML]="h"
      ></span>
    } @else {
      <span class="chat-md-math chat-md-math--raw">{{ raw() }}</span>
    }
  `,
})
export class MarkdownMathComponent {
  readonly node = input.required<MathNode>();
  private readonly sanitizer = inject(DomSanitizer);
  private readonly math = inject(ChatMathRenderer);

  protected readonly display = computed(() => this.node().type === 'math-display');

  protected readonly raw = computed(() => {
    const n = this.node();
    const [open, close] = DELIMITERS[n.delimiter];
    return `${open}${n.text}${close}`;
  });

  protected readonly html = computed<SafeHtml | null>(() => {
    this.math.ready(); // re-render once KaTeX finishes loading
    const n = this.node();
    const out = this.math.render(n.text, n.type === 'math-display');
    if (out == null) return null;
    // Trust KaTeX output directly: with KaTeX's default `trust:false` it emits
    // only safe presentational markup (no scripts/event handlers/links), and
    // Angular's HTML sanitizer would strip the inline styles KaTeX layout
    // depends on.
    return this.sanitizer.bypassSecurityTrustHtml(out);
  });
}
