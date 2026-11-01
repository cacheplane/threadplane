// libs/chat/src/lib/markdown/views/markdown-paragraph.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownParagraphNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders the child nodes of a markdown paragraph inside a paragraph element. */
@Component({
  selector: 'chat-md-paragraph',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p><chat-md-children [parent]="node()" /></p>`,
})
export class MarkdownParagraphComponent {
  readonly node = input.required<MarkdownParagraphNode>();
}
