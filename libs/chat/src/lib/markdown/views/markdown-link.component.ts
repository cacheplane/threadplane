// libs/chat/src/lib/markdown/views/markdown-link.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownLinkNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders a markdown link with its child nodes as the label and an optional title. */
@Component({
  selector: 'chat-md-link',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<a [href]="node().url" [attr.title]="node().title || null"><chat-md-children [parent]="node()" /></a>`,
})
export class MarkdownLinkComponent {
  readonly node = input.required<MarkdownLinkNode>();
}
