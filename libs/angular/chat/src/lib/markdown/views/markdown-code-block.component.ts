// libs/angular/chat/src/lib/markdown/views/markdown-code-block.component.ts
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import type { MarkdownCodeBlockNode } from '@cacheplane/partial-markdown';
import { MarkdownCodeCopyComponent } from './markdown-code-copy.component';

/**
 * Renders a markdown code block as escaped text with an optional language CSS class, and a Copy
 * button once the block's source is closed.
 */
@Component({
  selector: 'chat-md-code-block',
  standalone: true,
  imports: [MarkdownCodeCopyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="chat-md-code"><pre><code [class]="languageClass()">{{ node().text }}</code></pre>@if (node().status === 'complete') {<chat-md-code-copy [text]="node().text" />}</div>`,
})
export class MarkdownCodeBlockComponent {
  readonly node = input.required<MarkdownCodeBlockNode>();
  protected readonly languageClass = computed(() => {
    const lang = this.node().language;
    return lang ? `language-${lang}` : '';
  });
}
