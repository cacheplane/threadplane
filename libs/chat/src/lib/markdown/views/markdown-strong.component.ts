// libs/chat/src/lib/markdown/views/markdown-strong.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownStrongNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders markdown strong-emphasis content inside a strong element. */
@Component({
  selector: 'chat-md-strong',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<strong><chat-md-children [parent]="node()" /></strong>`,
})
export class MarkdownStrongComponent {
  readonly node = input.required<MarkdownStrongNode>();
}
