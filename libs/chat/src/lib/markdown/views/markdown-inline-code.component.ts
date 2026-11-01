// libs/chat/src/lib/markdown/views/markdown-inline-code.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownInlineCodeNode } from '@cacheplane/partial-markdown';

/** Renders a markdown inline-code node as escaped code text. */
@Component({
  selector: 'chat-md-inline-code',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<code>{{ node().text }}</code>`,
})
export class MarkdownInlineCodeComponent {
  readonly node = input.required<MarkdownInlineCodeNode>();
}
