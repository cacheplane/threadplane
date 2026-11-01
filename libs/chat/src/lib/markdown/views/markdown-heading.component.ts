// libs/chat/src/lib/markdown/views/markdown-heading.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownHeadingNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from '../markdown-children.component';

/** Renders a markdown heading and its child nodes at the specified heading level. */
@Component({
  selector: 'chat-md-heading',
  standalone: true,
  imports: [MarkdownChildrenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (node().level) {
      @case (1) { <h1><chat-md-children [parent]="node()" /></h1> }
      @case (2) { <h2><chat-md-children [parent]="node()" /></h2> }
      @case (3) { <h3><chat-md-children [parent]="node()" /></h3> }
      @case (4) { <h4><chat-md-children [parent]="node()" /></h4> }
      @case (5) { <h5><chat-md-children [parent]="node()" /></h5> }
      @case (6) { <h6><chat-md-children [parent]="node()" /></h6> }
    }
  `,
})
export class MarkdownHeadingComponent {
  readonly node = input.required<MarkdownHeadingNode>();
}
