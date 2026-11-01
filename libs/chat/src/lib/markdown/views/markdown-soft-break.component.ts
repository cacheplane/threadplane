// libs/chat/src/lib/markdown/views/markdown-soft-break.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownSoftBreakNode } from '@cacheplane/partial-markdown';

/** Renders a markdown soft-break node as an HTML line break. */
@Component({
  selector: 'chat-md-soft-break',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<br>`,
})
export class MarkdownSoftBreakComponent {
  readonly node = input.required<MarkdownSoftBreakNode>();
}
