// libs/chat/src/lib/markdown/views/markdown-document.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownDocumentNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders the child nodes of a markdown document through the markdown view registry. */
@Component({
  selector: 'chat-md-document',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<chat-md-children [parent]="node()" />`,
})
export class MarkdownDocumentComponent {
  readonly node = input.required<MarkdownDocumentNode>();
}
