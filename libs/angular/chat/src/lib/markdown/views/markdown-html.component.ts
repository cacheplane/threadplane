// libs/angular/chat/src/lib/markdown/views/markdown-html.component.ts
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import type {
  MarkdownHtmlBlockNode,
  MarkdownHtmlInlineNode,
} from '@cacheplane/partial-markdown';

/**
 * Renders a `html-block` / `html-inline` markdown node as **escaped text** —
 * the raw HTML is shown literally (Angular interpolation auto-escapes it),
 * never injected as live markup. This preserves the pre-0.4 behavior where
 * raw HTML was plain text, and keeps the chat XSS-safe: model-emitted
 * `<script>`, `<iframe>`, etc. are displayed as text and never executed.
 */
@Component({
  selector: 'chat-md-html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ raw() }}`,
})
export class MarkdownHtmlComponent {
  readonly node = input.required<MarkdownHtmlBlockNode | MarkdownHtmlInlineNode>();
  protected readonly raw = computed(() => this.node().raw);
}
