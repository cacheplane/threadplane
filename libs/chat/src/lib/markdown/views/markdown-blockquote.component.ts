// libs/chat/src/lib/markdown/views/markdown-blockquote.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownBlockquoteNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders the child nodes of a markdown blockquote inside a blockquote element. */
@Component({
  selector: 'chat-md-blockquote',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<blockquote><chat-md-children [parent]="node()" /></blockquote>`,
})
export class MarkdownBlockquoteComponent {
  readonly node = input.required<MarkdownBlockquoteNode>();
}
