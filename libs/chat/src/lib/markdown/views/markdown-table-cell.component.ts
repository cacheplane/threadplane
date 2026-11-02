// libs/chat/src/lib/markdown/views/markdown-table-cell.component.ts
import { Component, ChangeDetectionStrategy, input, inject, computed } from '@angular/core';
import type { MarkdownTableCellNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';
import { IS_HEADER_ROW } from '../markdown-table-row.token';

/** Renders a markdown table cell with its alignment and the containing row’s header status. */
@Component({
  selector: 'chat-md-table-cell',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isHeader()) {
      <th class="chat-md-table-cell" [style.text-align]="alignment() ?? null">
        <chat-md-children [parent]="node()" />
      </th>
    } @else {
      <td class="chat-md-table-cell" [style.text-align]="alignment() ?? null">
        <chat-md-children [parent]="node()" />
      </td>
    }
  `,
})
export class MarkdownTableCellComponent {
  readonly node = input.required<MarkdownTableCellNode>();

  private readonly isHeaderRowToken = inject(IS_HEADER_ROW, { optional: true });
  protected readonly isHeader = computed(() => this.isHeaderRowToken ? this.isHeaderRowToken() : false);
  protected readonly alignment = computed(() => this.node().alignment);
}
