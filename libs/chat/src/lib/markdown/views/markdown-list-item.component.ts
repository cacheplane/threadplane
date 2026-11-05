// libs/chat/src/lib/markdown/views/markdown-list-item.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownListItemNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/**
 * Renders a markdown list item. A task item keeps a disabled native checkbox
 * as the accessible control ("checkbox, checked, unavailable") but hides it
 * visually: browsers paint disabled checkboxes so faintly that checked and
 * unchecked are hard to tell apart. A token-coloured box draws the state.
 */
@Component({
  selector: 'chat-md-list-item',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <li [class.chat-md-list-item--task]="node().task !== undefined">
      @if (node().task; as task) {
        <input class="chat-md-task-input" type="checkbox" disabled [checked]="task.checked" />
        <span class="chat-md-task-box" [class.chat-md-task-box--checked]="task.checked" aria-hidden="true">
          @if (task.checked) {
            <svg viewBox="0 0 12 12"><polyline points="2.5 6.3 5 8.6 9.5 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          }
        </span>
      }
      <chat-md-children [parent]="node()" />
    </li>
  `,
})
export class MarkdownListItemComponent {
  readonly node = input.required<MarkdownListItemNode>();
}
