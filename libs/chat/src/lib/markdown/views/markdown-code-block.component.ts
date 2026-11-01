// libs/chat/src/lib/markdown/views/markdown-code-block.component.ts
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import type { MarkdownCodeBlockNode } from '@cacheplane/partial-markdown';

/** Renders a markdown code block as escaped text with an optional language CSS class. */
@Component({
  selector: 'chat-md-code-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pre><code [class]="languageClass()">{{ node().text }}</code></pre>`,
})
export class MarkdownCodeBlockComponent {
  readonly node = input.required<MarkdownCodeBlockNode>();
  protected readonly languageClass = computed(() => {
    const lang = this.node().language;
    return lang ? `language-${lang}` : '';
  });
}
