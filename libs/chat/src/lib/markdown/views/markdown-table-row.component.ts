// libs/chat/src/lib/markdown/views/markdown-table-row.component.ts
import { NgComponentOutlet } from '@angular/common';
import { Component, ChangeDetectionStrategy, input, computed, inject, type Type } from '@angular/core';
import type { ViewRegistry } from '@threadplane/render';
import type { MarkdownNode, MarkdownTableRowNode } from '@cacheplane/partial-markdown';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';
import { IS_HEADER_ROW } from '../markdown-table-row.token';

/** Renders markdown table-row children through the view registry and provides their header status. */
@Component({
  selector: 'chat-md-table-row',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tr class="chat-md-table-row" [class.chat-md-table-row--header]="node().isHeader">
      @for (child of node().children; track $index) {
        @let comp = resolve(child);
        @if (comp) {
          <ng-container *ngComponentOutlet="comp; inputs: { node: child }" />
        }
      }
    </tr>
  `,
  providers: [
    {
      provide: IS_HEADER_ROW,
      useFactory: () => {
        const comp = inject(MarkdownTableRowComponent);
        return computed(() => comp.node().isHeader);
      },
    },
  ],
})
export class MarkdownTableRowComponent {
  readonly node = input.required<MarkdownTableRowNode>();
  private readonly registry = inject<ViewRegistry>(MARKDOWN_VIEW_REGISTRY);

  protected resolve(child: MarkdownNode): Type<unknown> | null {
    const entry = this.registry[child.type];
    if (!entry) return null;
    return typeof entry === 'function' ? entry : entry.component;
  }
}
