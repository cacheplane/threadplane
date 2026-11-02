// libs/chat/src/lib/markdown/views/markdown-list-item.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownListItemNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders a markdown list item with a disabled checkbox for task items. */
@Component({
  selector: 'chat-md-list-item',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <li [class.chat-md-list-item--task]="node().task !== undefined">
      @if (node().task !== undefined) {
        <input type="checkbox" disabled [checked]="node().task!.checked" />
      }
      <chat-md-children [parent]="node()" />
    </li>
  `,
})
export class MarkdownListItemComponent {
  readonly node = input.required<MarkdownListItemNode>();
}
