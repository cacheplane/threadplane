// libs/chat/src/lib/markdown/views/markdown-list.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownListNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders an ordered or unordered markdown list, preserving its optional starting number. */
@Component({
  selector: 'chat-md-list',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (node().ordered) {
      <ol [attr.start]="node().start ?? null"><chat-md-children [parent]="node()" /></ol>
    } @else {
      <ul><chat-md-children [parent]="node()" /></ul>
    }
  `,
})
export class MarkdownListComponent {
  readonly node = input.required<MarkdownListNode>();
}
