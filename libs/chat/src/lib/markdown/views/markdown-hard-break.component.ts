// libs/chat/src/lib/markdown/views/markdown-hard-break.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownHardBreakNode } from '@cacheplane/partial-markdown';

/** Renders a markdown hard-break node as an HTML line break. */
@Component({
  selector: 'chat-md-hard-break',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<br>`,
})
export class MarkdownHardBreakComponent {
  readonly node = input.required<MarkdownHardBreakNode>();
}
