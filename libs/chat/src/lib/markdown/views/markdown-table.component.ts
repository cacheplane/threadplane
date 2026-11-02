// libs/chat/src/lib/markdown/views/markdown-table.component.ts
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import type { MarkdownTableNode, MarkdownTableRowNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders a markdown table with separate header and body rows and per-cell alignment. */
@Component({
  selector: 'chat-md-table',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table class="chat-md-table">
      <thead>
        @if (headerRow(); as row) {
          <tr class="chat-md-table-row chat-md-table-row--header">
            @for (cell of row.children; track $index) {
              <th class="chat-md-table-cell" [style.text-align]="cell.alignment ?? null">
                <chat-md-children [parent]="cell" />
              </th>
            }
          </tr>
        }
      </thead>
      <tbody>
        @for (row of bodyRows(); track $index) {
          <tr class="chat-md-table-row">
            @for (cell of row.children; track $index) {
              <td class="chat-md-table-cell" [style.text-align]="cell.alignment ?? null">
                <chat-md-children [parent]="cell" />
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class MarkdownTableComponent {
  readonly node = input.required<MarkdownTableNode>();

  protected readonly headerRow = computed<MarkdownTableRowNode | null>(() => {
    const rows = this.node().children;
    return rows.length > 0 && rows[0].isHeader ? rows[0] : null;
  });

  protected readonly bodyRows = computed<MarkdownTableRowNode[]>(() => {
    const rows = this.node().children;
    return rows[0]?.isHeader ? rows.slice(1) : rows;
  });
}
